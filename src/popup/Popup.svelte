<script lang="ts">
  import Settings from './Settings.svelte';
  import ProfileStatus from './ProfileStatus.svelte';
  import type { Recommendation, RecommendationResult, SourceError } from '../types/recommendation';
  import type { UserProfile } from '../types/letterboxd';
  import { JUSTWATCH_REGION_CODES } from '../lib/constants/justwatch-regions';
  type ServiceHealth = { status: 'normal' | 'degraded'; reason: string | null; updatedAt: number };

  let showSettings = $state(false);
  let recommendations: Recommendation[] = $state([]);
  let sourceWarnings: SourceError[] = $state([]);
  let loading = $state(false);
  let loadingMode = $state<'idle' | 'scanning' | 'recommending'>('idle');
  const loadingStages = [
    'Resolving your top seed films...',
    'Fetching TMDb recommendation graph...',
    'Searching Reddit and Taste.io...',
    'Scoring and filtering final results...',
  ];
  let loadingStageIndex = $state(0);
  let loadingStageTimer: ReturnType<typeof setInterval> | null = null;
  let error: string | null = $state(null);
  let username = $state('');
  let profile: UserProfile | null = $state(null);
  let justWatchRegionSetting = $state('auto');
  const currentMode = new URLSearchParams(window.location.search).get('mode');
  const isWindowMode = currentMode === 'window';
  let recommendationGeneratedAt: number | null = $state(null);
  let recommendationSeedCount: number | null = $state(null);
  let serviceHealth: ServiceHealth = $state({ status: 'normal', reason: null, updatedAt: 0 });
  const PENDING_GENERATION_KEY = 'lb_rec_pending_generation';

  // Watchlist button states keyed by tmdbId
  let watchlistState: Record<number, 'idle' | 'loading' | 'added' | 'opened'> = $state({});
  const justWatchDirectUrlValidityCache = new Set<string>();

  function startRecommendationLoading(): void {
    loading = true;
    loadingMode = 'recommending';
    loadingStageIndex = 0;
    if (loadingStageTimer) clearInterval(loadingStageTimer);
    loadingStageTimer = setInterval(() => {
      loadingStageIndex = Math.min(loadingStageIndex + 1, loadingStages.length - 1);
    }, 1400);
  }

  function stopLoading(): void {
    loading = false;
    loadingMode = 'idle';
    if (loadingStageTimer) {
      clearInterval(loadingStageTimer);
      loadingStageTimer = null;
    }
  }

  async function setPendingGeneration(username: string): Promise<void> {
    await chrome.storage.local.set({
      [PENDING_GENERATION_KEY]: { username: username.toLowerCase(), startedAt: Date.now() },
    });
  }

  async function clearPendingGeneration(): Promise<void> {
    await chrome.storage.local.remove(PENDING_GENERATION_KEY);
  }

  async function getPendingGeneration(): Promise<{ username: string; startedAt: number } | null> {
    const result = await chrome.storage.local.get(PENDING_GENERATION_KEY);
    const pending = result[PENDING_GENERATION_KEY] as { username: string; startedAt: number } | undefined;
    if (!pending) return null;
    // 10-minute safety window
    if (Date.now() - pending.startedAt > 10 * 60 * 1000) {
      await clearPendingGeneration();
      return null;
    }
    return pending;
  }

  async function loadSettings() {
    const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    if (settings.launchMode === 'window' && !isWindowMode) {
      await chrome.runtime.sendMessage({ type: 'OPEN_APP_WINDOW' });
      window.close();
      return;
    }
    justWatchRegionSetting = settings.justWatchRegion || 'auto';
    const detectedUsername = settings.letterboxdUsername || '';

    if (!detectedUsername) {
      username = '';
      return;
    }

    // Load startup state in parallel to reduce reopen latency.
    const [p, cached, generatingStatus, pendingGeneration, health] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'GET_PROFILE', username: detectedUsername }),
      chrome.runtime.sendMessage({
        type: 'GET_RECOMMENDATIONS',
        username: detectedUsername,
        forceRefresh: false,
      }),
      chrome.runtime.sendMessage({ type: 'GET_GENERATING_STATUS' }),
      getPendingGeneration(),
      chrome.runtime.sendMessage({ type: 'GET_SERVICE_HEALTH' }),
    ]);

    // Set profile BEFORE username so the template never sees username+null profile.
    if (p) profile = p;
    if (health && health.status) serviceHealth = health as ServiceHealth;
    username = detectedUsername;

    // Restore cached recommendations so they persist across popup opens
    if (cached?.type === 'RECOMMENDATIONS_READY') {
      recommendations = cached.result.recommendations;
      sourceWarnings = cached.result.sourceErrors ?? [];
      recommendationGeneratedAt = cached.result.generatedAt;
      recommendationSeedCount = cached.result.seedCount;

      // Restore watchlist button state for films added via the extension
      const stored = await chrome.storage.local.get('lb_rec_watchlist_adds');
      const addedSlugs: string[] = (stored['lb_rec_watchlist_adds'] as string[]) ?? [];
      if (addedSlugs.length > 0) {
        const slugSet = new Set(addedSlugs);
        for (const rec of recommendations) {
          const slug = extractSlugFromUrl(recLetterboxdUrl(rec));
          if (slug && slugSet.has(slug)) {
            watchlistState[rec.tmdbId] = 'added';
          }
        }
      }
    }

    // If cache is newer than the pending marker, a previous run already finished.
    // Clear stale pending state so we don't trigger an unnecessary force refresh.
    if (
      cached?.type === 'RECOMMENDATIONS_READY'
      && pendingGeneration?.username === detectedUsername.toLowerCase()
      && cached.result.generatedAt >= pendingGeneration.startedAt
    ) {
      await clearPendingGeneration();
    }

    if (
      generatingStatus?.username === detectedUsername.toLowerCase()
      || pendingGeneration?.username === detectedUsername.toLowerCase()
    ) {
      // A generation is in progress — show loading and attach to it
      startRecommendationLoading();
      error = null;

      try {
        const result = await chrome.runtime.sendMessage({
          type: 'GET_RECOMMENDATIONS',
          username: detectedUsername,
          forceRefresh: true, // Deduplicates in service worker — won't start a new generation
        });

        if (result?.type === 'ERROR') {
          error = result.error;
          await clearPendingGeneration();
        } else if (result?.type === 'RECOMMENDATIONS_READY') {
          recommendations = result.result.recommendations;
          sourceWarnings = result.result.sourceErrors ?? [];
          recommendationGeneratedAt = result.result.generatedAt;
          recommendationSeedCount = result.result.seedCount;
          await clearPendingGeneration();
        }
      } catch (e) {
        error = e instanceof Error ? e.message : 'Failed to get recommendations';
      } finally {
        stopLoading();
      }
    }
  }

  async function getRecommendations() {
    if (!username) {
      error = 'No account detected yet. Visit any Letterboxd page while logged in to auto-detect your account.';
      return;
    }

    startRecommendationLoading();
    error = null;
    await setPendingGeneration(username);

    try {
      const result = await chrome.runtime.sendMessage({
        type: 'GET_RECOMMENDATIONS',
        username,
        forceRefresh: true,
      });

      if (result.type === 'ERROR') {
        error = result.error;
        await clearPendingGeneration();
      } else if (result.type === 'RECOMMENDATIONS_READY') {
        recommendations = result.result.recommendations;
        sourceWarnings = result.result.sourceErrors ?? [];
        recommendationGeneratedAt = result.result.generatedAt;
        recommendationSeedCount = result.result.seedCount;
        await clearPendingGeneration();
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to get recommendations';
      await clearPendingGeneration();
    } finally {
      stopLoading();
    }
  }

  async function scanProfile() {
    if (!username) {
      error = 'No account detected yet. Visit any Letterboxd page while logged in to auto-detect your account.';
      return;
    }

    loading = true;
    loadingMode = 'scanning';
    error = null;

    try {
      await chrome.runtime.sendMessage({ type: 'SCRAPE_PROFILE', username });
      const p = await chrome.runtime.sendMessage({ type: 'GET_PROFILE', username });
      if (p) profile = p;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to scan profile';
    } finally {
      stopLoading();
    }
  }

  function posterUrl(path: string | null): string {
    return path ? `https://image.tmdb.org/t/p/w185${path}` : '';
  }

  function normalizeJustWatchRegion(input: string | null | undefined): string | null {
    if (!input) return null;
    const normalized = input.toLowerCase();
    return JUSTWATCH_REGION_CODES.has(normalized) ? normalized : null;
  }

  function autoJustWatchRegion(): string {
    const locale = (chrome.i18n?.getUILanguage?.() || navigator.language || '').trim();
    const regionFromLocale = locale.match(/[-_]([a-z]{2})$/i)?.[1]?.toLowerCase();
    const fromLocale = normalizeJustWatchRegion(regionFromLocale);
    if (fromLocale) return fromLocale;

    // Language-only fallback when no explicit region exists.
    const lang = locale.slice(0, 2).toLowerCase();
    const fallbackByLanguage: Record<string, string> = {
      en: 'us',
      es: 'es',
      fr: 'fr',
      de: 'de',
      it: 'it',
      pt: 'br',
      ja: 'jp',
      ko: 'kr',
      hi: 'in',
    };
    const mapped = fallbackByLanguage[lang];
    return normalizeJustWatchRegion(mapped) ?? 'us';
  }

  function effectiveJustWatchRegion(): string {
    if (justWatchRegionSetting && justWatchRegionSetting !== 'auto') {
      return normalizeJustWatchRegion(justWatchRegionSetting) ?? 'us';
    }
    return autoJustWatchRegion();
  }

  function justWatchSlug(title: string): string {
    return title
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-+/g, '-');
  }

  function justWatchSearchUrl(region: string, rec: Recommendation): string {
    const query = rec.year ? `${rec.title} ${rec.year}` : rec.title;
    return `https://www.justwatch.com/${region}/search?q=${encodeURIComponent(query)}`;
  }

  function justWatchMovieUrl(region: string, slug: string): string {
    return `https://www.justwatch.com/${region}/movie/${slug}`;
  }

  function isJustWatchMoviePath(url: string, region: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.hostname === 'www.justwatch.com' && parsed.pathname.startsWith(`/${region}/movie/`);
    } catch {
      return false;
    }
  }

  async function shouldUseRegionalJustWatchDirectUrl(region: string, slug: string): Promise<boolean> {
    const cacheKey = `${region}:${slug}`;
    if (justWatchDirectUrlValidityCache.has(cacheKey)) return true;

    const directUrl = justWatchMovieUrl(region, slug);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 850);

    try {
      const response = await fetch(directUrl, {
        method: 'GET',
        redirect: 'follow',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) return false;

      if (!isJustWatchMoviePath(response.url || directUrl, region)) return false;
      justWatchDirectUrlValidityCache.add(cacheKey);
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function openJustWatch(e: MouseEvent, rec: Recommendation): Promise<void> {
    e.preventDefault();
    e.stopPropagation();
    const slug = justWatchSlug(rec.title);
    const region = effectiveJustWatchRegion();

    if (justWatchRegionSetting === 'auto' || !justWatchRegionSetting) {
      const url = slug ? justWatchMovieUrl('us', slug) : justWatchSearchUrl('us', rec);
      window.open(url, '_blank', 'noopener');
      return;
    }

    if (slug && await shouldUseRegionalJustWatchDirectUrl(region, slug)) {
      window.open(justWatchMovieUrl(region, slug), '_blank', 'noopener');
      return;
    }

    window.open(justWatchSearchUrl(region, rec), '_blank', 'noopener');
  }

  function handleSettingsSaved() {
    loadSettings();
  }

  function timeAgo(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  function scoreBand(score: number): 'high' | 'mid' | 'low' {
    if (score >= 75) return 'high';
    if (score >= 50) return 'mid';
    return 'low';
  }

  function recommendationAgeLabel(timestamp: number): string {
    const diff = Math.max(0, Date.now() - timestamp);
    const totalMinutes = Math.floor(diff / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours <= 0) return `${totalMinutes}m AGO`;
    return `${hours}h ${minutes}m AGO`;
  }

  function openScoringDoc(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    chrome.tabs.create({
      url: chrome.runtime.getURL('src/scoring/index.html'),
    });
  }

  function extractSlugFromUrl(url: string): string {
    // url is like https://letterboxd.com/film/parasite/
    const match = url.match(/\/film\/([^/]+)/);
    return match ? match[1] : '';
  }

  function recLetterboxdUrl(rec: Recommendation): string {
    return rec.letterboxdUrl;
  }

  function openLetterboxdHome(): void {
    chrome.tabs.create({ url: 'https://letterboxd.com/' });
  }

  async function openLetterboxdFilm(e: MouseEvent, rec: Recommendation): Promise<void> {
    e.preventDefault();
    e.stopPropagation();

    const fallbackUrl = recLetterboxdUrl(rec);
    const slug = extractSlugFromUrl(fallbackUrl);
    if (!slug) {
      window.open(fallbackUrl, '_blank', 'noopener');
      return;
    }

    try {
      const result = await chrome.runtime.sendMessage({
        type: 'OPEN_LETTERBOXD_FILM',
        tmdbId: rec.tmdbId,
        filmSlug: slug,
        filmTitle: rec.title,
        filmYear: rec.year,
      });
      if (result?.success) return;
    } catch {
      // Fallback to best-effort URL if background open fails.
    }

    window.open(fallbackUrl, '_blank', 'noopener');
  }

  async function refreshAccountDetection(): Promise<void> {
    await loadSettings();
  }

  async function addToWatchlist(e: MouseEvent, rec: Recommendation) {
    e.preventDefault();
    e.stopPropagation();

    const slug = extractSlugFromUrl(recLetterboxdUrl(rec));
    if (!slug) return;

    watchlistState[rec.tmdbId] = 'loading';

    try {
      const result = await chrome.runtime.sendMessage({
        type: 'ADD_TO_WATCHLIST',
        filmSlug: slug,
        filmTitle: rec.title,
        filmYear: rec.year,
      });

      if (result?.success) {
        watchlistState[rec.tmdbId] = 'added';
      } else if (result?.error) {
        // All error types (no-lid, no-csrf, not-authenticated, request-failed)
        // cause the service worker to open a fallback tab to the film page.
        watchlistState[rec.tmdbId] = 'opened';
        // Reset after 2 seconds
        setTimeout(() => { watchlistState[rec.tmdbId] = 'idle'; }, 2000);
      } else {
        watchlistState[rec.tmdbId] = 'idle';
      }
    } catch {
      watchlistState[rec.tmdbId] = 'idle';
    }
  }

  // Load on mount
  loadSettings();
</script>

<div class="popup">
  <!-- Header bar -->
  <header class="header">
    <div class="header-left">
      <span class="logo-dot"></span>
      <h1 class="logo-text">Lekkerboxd</h1>
    </div>
    <button
      class="gear-btn"
      class:gear-active={showSettings}
      onclick={() => showSettings = !showSettings}
      title="Settings"
    >
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
        <path d="M10 13a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" stroke-width="1.5"/>
        <path d="M10 1.5l1.3 2.2a1 1 0 00.9.5h2.5l.7 2.4a1 1 0 00.5.6l2.1 1.3-.7 2.5a1 1 0 000 .8l.7 2.5-2.1 1.3a1 1 0 00-.5.6l-.7 2.4h-2.5a1 1 0 00-.9.5L10 18.5l-1.3-2.2a1 1 0 00-.9-.5H5.3l-.7-2.4a1 1 0 00-.5-.6L2 11.5l.7-2.5a1 1 0 000-.8L2 5.7l2.1-1.3a1 1 0 00.5-.6l.7-2.4h2.5a1 1 0 00.9-.5L10 1.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
      </svg>
    </button>
  </header>

  <!-- Settings panel (slide-over) -->
  {#if showSettings}
    <div class="settings-panel">
      <Settings onSaved={handleSettingsSaved} />
    </div>
  {:else}
    <main class="body">
      <!-- Profile section -->
      {#if !username}
        <div class="welcome-card">
          <div class="welcome-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <path d="M15.5 7.5a3.5 3.5 0 11-7 0 3.5 3.5 0 017 0zM4 19.5c0-3.6 3.6-6.5 8-6.5s8 2.9 8 6.5" stroke="#567" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </div>
          <h3 class="welcome-title">Three steps to get started</h3>
          <div class="onboarding-steps">
            <div class="onboarding-step">
              <span class="onboarding-num">1</span>
              <span>Click the Chrome puzzle icon and pin Lekkerboxd</span>
            </div>
            <div class="onboarding-step">
              <span class="onboarding-num">2</span>
              <span>Open Letterboxd and log into your account</span>
            </div>
            <div class="onboarding-step">
              <span class="onboarding-num">3</span>
              <span>Come back here and refresh account detection</span>
            </div>
          </div>
          <div class="onboarding-actions">
            <button class="action-btn secondary" onclick={openLetterboxdHome}>Open Letterboxd</button>
            <button class="action-btn ghost" onclick={refreshAccountDetection}>I’m logged in, refresh</button>
          </div>
        </div>
      {:else if !profile}
        <div class="profile-card">
          <div class="profile-header-row">
            <a class="profile-username" href="https://letterboxd.com/{username}" target="_blank" rel="noopener">
              {username}
            </a>
            <span class="profile-status-chip not-scanned">Not scanned</span>
          </div>
          <p class="profile-hint">Scan your profile to analyze your film taste</p>
        </div>

        <button class="action-btn primary" onclick={scanProfile} disabled={loading}>
          {#if loading}
            <span class="btn-spinner"></span>
            Scanning profile...
          {:else}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            Scan Profile
          {/if}
        </button>
      {:else}
        <!-- Scanned profile compact bar -->
        <div class="profile-card scanned">
          <div class="profile-header-row">
            <a class="profile-username" href="https://letterboxd.com/{username}" target="_blank" rel="noopener">
              {username}
            </a>
            <span class="profile-status-chip scanned-chip">Scanned {timeAgo(profile.scrapedAt)}</span>
          </div>
          <div class="stats-row">
            <div class="stat-item">
              <span class="stat-num">{profile.watchedFilms.length}</span>
              <span class="stat-label">watched</span>
            </div>
            <div class="stat-divider"></div>
            <div class="stat-item">
              <span class="stat-num">{profile.ratedFilms.length}</span>
              <span class="stat-label">rated</span>
            </div>
            <div class="stat-divider"></div>
            <div class="stat-item">
              <span class="stat-num">{profile.likedFilms.length}</span>
              <span class="stat-label">liked</span>
            </div>
            <div class="stat-divider"></div>
            <div class="stat-item">
              <span class="stat-num">{profile.watchlist.length}</span>
              <span class="stat-label">watchlist</span>
            </div>
          </div>
        </div>

        <!-- Action button -->
        <button class="action-btn primary" onclick={getRecommendations} disabled={loading}>
          {#if loading}
            <span class="btn-spinner"></span>
            Analyzing taste...
          {:else}
            Get Recommendations
          {/if}
        </button>
      {/if}

      <!-- Error -->
      {#if error}
        <div class="error-bar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="#f88" stroke-width="1.5"/>
            <path d="M12 8v4m0 4h.01" stroke="#f88" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          {error}
        </div>
      {/if}

      {#if serviceHealth.status === 'degraded' && !loading}
        <div class="degraded-bar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L2 22h20L12 2z" stroke="#ffcc66" stroke-width="1.5" stroke-linejoin="round"/>
            <path d="M12 9v5m0 4h.01" stroke="#ffcc66" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <span>{serviceHealth.reason || 'Some Letterboxd features are temporarily degraded. Using fallback behavior.'}</span>
        </div>
      {/if}

      <!-- Source warnings -->
      {#if sourceWarnings.length > 0 && !loading}
        <div class="warn-bar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L2 22h20L12 2z" stroke="#FF8000" stroke-width="1.5" stroke-linejoin="round"/>
            <path d="M12 10v4m0 4h.01" stroke="#FF8000" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <span>{sourceWarnings.map(w => w.error).join('. ')}</span>
        </div>
      {/if}

      <!-- Settings hint when no recommendations yet -->
      {#if profile && recommendations.length === 0 && !loading}
        <div class="settings-hint">
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
            <path d="M10 13a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" stroke-width="1.5"/>
            <path d="M10 1.5l1.3 2.2a1 1 0 00.9.5h2.5l.7 2.4a1 1 0 00.5.6l2.1 1.3-.7 2.5a1 1 0 000 .8l.7 2.5-2.1 1.3a1 1 0 00-.5.6l-.7 2.4h-2.5a1 1 0 00-.9.5L10 18.5l-1.3-2.2a1 1 0 00-.9-.5H5.3l-.7-2.4a1 1 0 00-.5-.6L2 11.5l.7-2.5a1 1 0 000-.8L2 5.7l2.1-1.3a1 1 0 00.5-.6l.7-2.4h2.5a1 1 0 00.9-.5L10 1.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
          </svg>
          <span>Tip: Check out <button class="settings-hint-link" onclick={() => showSettings = true}>Settings</button> to customize how many seeds, recommendations, and how aggressively to filter popular films.</span>
        </div>
      {/if}

      <!-- Loading -->
      {#if loading && profile && loadingMode === 'recommending'}
        <div class="loading-state">
          <div class="spinner"></div>
          <p>{loadingStages[loadingStageIndex]}</p>
          <div class="loading-track">
            <div class="loading-fill" style="width: {((loadingStageIndex + 1) / loadingStages.length) * 100}%"></div>
          </div>
        </div>
      {/if}

      <!-- Recommendations -->
      {#if recommendations.length > 0}
        <div class="rec-header">
          <span class="rec-count-left">
            {recommendations.length} SUGGESTIONS &bull; {recommendationSeedCount ?? 0} SEEDS
          </span>
          {#if recommendationGeneratedAt !== null}
            <span class="rec-count-right">{recommendationAgeLabel(recommendationGeneratedAt)}</span>
          {/if}
        </div>
        <div class="rec-list">
          {#each recommendations as rec, i}
            <a
              class="rec-card"
              class:score-high-card={scoreBand(rec.score) === 'high'}
              class:score-mid-card={scoreBand(rec.score) === 'mid'}
              class:score-low-card={scoreBand(rec.score) === 'low'}
              href={recLetterboxdUrl(rec)}
              target="_blank"
              rel="noopener"
              onclick={(e: MouseEvent) => openLetterboxdFilm(e, rec)}
            >
              <div class="rec-poster-wrap">
                {#if rec.posterPath}
                  <img
                    class="rec-poster"
                    src={posterUrl(rec.posterPath)}
                    alt={rec.title}
                    loading="lazy"
                  />
                {:else}
                  <div class="rec-poster-placeholder">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <rect x="2" y="3" width="20" height="18" rx="2" stroke="#456" stroke-width="1.5"/>
                      <path d="M2 8h20" stroke="#456" stroke-width="1.5"/>
                    </svg>
                  </div>
                {/if}
              </div>
              <div class="rec-info">
                <div class="rec-title-row">
                  <span class="rec-title">
                    {rec.title}
                    {#if rec.year}
                      <span class="rec-title-year">&nbsp;&bull;&nbsp;{rec.year}</span>
                    {/if}
                  </span>
                </div>
                <div class="rec-meta">
                  {#if rec.genres.length > 0}
                    {rec.genres.slice(0, 2).join(', ')} &middot;
                  {/if}
                  TMDb {rec.tmdbRating.toFixed(1)}
                </div>
                <div class="rec-badges">
                  {#if rec.onWatchlist || watchlistState[rec.tmdbId] === 'added'}
                    <span class="badge watchlist">Watchlist</span>
                  {/if}
                  {#each [...new Set(rec.hits.map(h => h.source))] as source}
                    <span class="badge source">{source === 'tmdb-recommendation' ? 'TMDb' : source === 'tmdb-similar' ? 'Similar' : source === 'reddit' ? 'Reddit' : 'Taste.io'}</span>
                  {/each}
                </div>
                <div class="rec-because">
                  Because you liked {rec.hits.map(h => h.seedFilmTitle).filter((v, i, a) => a.indexOf(v) === i).slice(0, 2).join(' & ')}
                </div>
              </div>
              <!-- Score pill: top-right corner -->
              <button
                class="rec-score-pill tip"
                class:band-high={scoreBand(rec.score) === 'high'}
                class:band-mid={scoreBand(rec.score) === 'mid'}
                class:band-low={scoreBand(rec.score) === 'low'}
                onclick={openScoringDoc}
                data-tip="How this is scored"
                aria-label="How this is scored"
              >
                {rec.score}
              </button>
              <button
                class="wl-btn jw-btn tip"
                onclick={(e: MouseEvent) => openJustWatch(e, rec)}
                data-tip="Where to watch"
                aria-label="Where to watch"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M1.5 12s3.8-6.5 10.5-6.5S22.5 12 22.5 12s-3.8 6.5-10.5 6.5S1.5 12 1.5 12z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                  <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>
                </svg>
              </button>
              <!-- Watchlist button: bottom-right corner -->
              {#if rec.onWatchlist || watchlistState[rec.tmdbId] === 'added'}
                <span class="wl-btn wl-added tip" data-tip="On your watchlist" aria-label="On your watchlist">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                    <path d="M20 6L9 17l-5-5" stroke="#00E054" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </span>
              {:else if watchlistState[rec.tmdbId] === 'loading'}
                <button class="wl-btn wl-loading tip" disabled data-tip="Adding to watchlist..." aria-label="Adding to watchlist...">
                  <span class="wl-spinner"></span>
                </button>
              {:else if watchlistState[rec.tmdbId] === 'opened'}
                <span class="wl-btn wl-opened tip" data-tip="Opened in new tab" aria-label="Opened in new tab">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" stroke="#789" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </span>
              {:else}
                <button class="wl-btn tip" onclick={(e: MouseEvent) => addToWatchlist(e, rec)} data-tip="Add to watchlist" aria-label="Add to watchlist">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
                  </svg>
                </button>
              {/if}
            </a>
          {/each}
        </div>
      {/if}
    </main>
  {/if}
</div>

<style>
  .popup {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  /* ── Header ── */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: #0D1117;
    border-bottom: 1px solid #2C3641;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .logo-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #00E054;
    flex-shrink: 0;
  }

  .logo-text {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    color: #fff;
    letter-spacing: 0.5px;
  }

  .gear-btn {
    background: none;
    border: none;
    color: #567;
    cursor: pointer;
    padding: 4px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
  }

  .gear-btn:hover { color: #9AB; background: #1B2028; }
  .gear-btn.gear-active { color: #00E054; background: #1B2028; }

  /* ── Settings panel ── */
  .settings-panel {
    flex: 1;
    overflow-y: auto;
    padding: 14px;
  }

  /* ── Body ── */
  .body {
    flex: 1;
    overflow-y: auto;
    scrollbar-gutter: stable;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  /* ── Welcome (no user) ── */
  .welcome-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    text-align: center;
    color: #567;
  }

  .welcome-icon {
    margin-bottom: 12px;
    opacity: 0.5;
  }

  .welcome-title {
    margin: 0 0 10px;
    font-size: 14px;
    color: #def;
  }

  .onboarding-steps {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    max-width: 290px;
    margin-bottom: 12px;
  }

  .onboarding-step {
    display: flex;
    align-items: center;
    gap: 8px;
    text-align: left;
    font-size: 11px;
    color: #789;
    padding: 8px 10px;
    border: 1px solid #2C3641;
    border-radius: 8px;
    background: #1B2028;
  }

  .onboarding-num {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
    color: #0d1117;
    background: #00E054;
    flex-shrink: 0;
  }

  .onboarding-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    max-width: 290px;
  }

  :global(body.window-mode) .onboarding-steps,
  :global(body.window-mode) .onboarding-actions {
    max-width: none;
  }

  /* ── Profile card ── */
  .profile-card {
    padding: 12px 14px;
    background: #1B2028;
    border-radius: 8px;
    border: 1px solid #2C3641;
  }

  .profile-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  .profile-username {
    font-size: 14px;
    font-weight: 700;
    color: #fff;
    text-decoration: none;
  }

  .profile-username:hover { color: #00E054; }

  .profile-status-chip {
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 10px;
    font-weight: 500;
  }

  .profile-status-chip.not-scanned {
    background: #2C3440;
    color: #789;
  }

  .profile-status-chip.scanned-chip {
    background: rgba(0, 224, 84, 0.1);
    color: #00E054;
  }

  .profile-hint {
    margin: 4px 0 0;
    font-size: 11px;
    color: #567;
  }

  /* ── Stats row ── */
  .stats-row {
    display: flex;
    align-items: center;
    gap: 0;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid #2C3641;
  }

  .stat-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
  }

  .stat-num {
    font-size: 15px;
    font-weight: 700;
    color: #DEF;
  }

  .stat-label {
    font-size: 9px;
    color: #567;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .stat-divider {
    width: 1px;
    height: 24px;
    background: #2C3641;
  }

  /* ── Action button ── */
  .action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    min-height: 38px;
    height: 38px;
    box-sizing: border-box;
    border: none;
    border-radius: 20px;
    font-size: 13px;
    font-weight: 600;
    line-height: 1;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
    flex-shrink: 0;
    transition: background-color 0.15s, color 0.15s, border-color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s;
  }

  .action-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .action-btn.primary {
    background: #00E054;
    color: #fff;
    padding: 0 20px;
  }

  .action-btn.primary:hover:not(:disabled) {
    background: #00C848;
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 224, 84, 0.25);
  }

  .action-btn.secondary {
    background: #2C3440;
    color: #DEF;
  }

  .action-btn.secondary:hover:not(:disabled) {
    background: #36414f;
  }

  .action-btn.ghost {
    background: transparent;
    color: #789;
    border: 1px solid #2C3641;
  }

  .action-btn.ghost:hover:not(:disabled) {
    color: #9ab;
    border-color: #3a4656;
  }

  .btn-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  /* ── Error ── */
  .error-bar {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    background: rgba(255, 80, 80, 0.08);
    border: 1px solid rgba(255, 80, 80, 0.2);
    color: #f88;
    padding: 10px 12px;
    border-radius: 8px;
    font-size: 11px;
    line-height: 1.4;
  }

  .error-bar svg { flex-shrink: 0; margin-top: 1px; }

  .warn-bar {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    background: rgba(255, 128, 0, 0.06);
    border: 1px solid rgba(255, 128, 0, 0.15);
    color: #FF8000;
    padding: 8px 10px;
    border-radius: 8px;
    font-size: 10px;
    line-height: 1.4;
  }

  .warn-bar svg { flex-shrink: 0; margin-top: 1px; }

  .degraded-bar {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    background: rgba(255, 204, 102, 0.08);
    border: 1px solid rgba(255, 204, 102, 0.22);
    color: #ffcc66;
    padding: 8px 10px;
    border-radius: 8px;
    font-size: 10.5px;
    line-height: 1.4;
  }

  .degraded-bar svg { flex-shrink: 0; margin-top: 1px; }

  /* ── Settings hint ── */
  .settings-hint {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 12px;
    background: rgba(0, 224, 84, 0.05);
    border: 1px solid rgba(0, 224, 84, 0.15);
    border-radius: 8px;
    font-size: 11.5px;
    line-height: 1.5;
    color: #789;
  }

  .settings-hint svg {
    flex-shrink: 0;
    margin-top: 2px;
    color: #00E054;
  }

  .settings-hint-link {
    background: none;
    border: none;
    color: #00E054;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    padding: 0;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .settings-hint-link:hover {
    color: #33ff77;
  }

  /* ── Loading ── */
  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 32px 16px;
    color: #567;
  }

  .spinner {
    width: 24px;
    height: 24px;
    border: 2.5px solid #2C3440;
    border-top-color: #00E054;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .loading-state p {
    margin: 14px 0 0;
    font-size: 12px;
    text-align: center;
  }

  .loading-track {
    margin-top: 10px;
    width: 100%;
    max-width: 220px;
    height: 5px;
    border-radius: 999px;
    background: #2C3440;
    overflow: hidden;
  }

  :global(body.window-mode) .loading-track {
    max-width: none;
  }

  .loading-fill {
    height: 100%;
    background: linear-gradient(90deg, #00b84a, #00e054);
    transition: width 0.35s ease;
  }

  /* ── Recommendations ── */
  .rec-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    white-space: nowrap;
  }

  .rec-count-left {
    font-size: 11px;
    color: #567;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .rec-count-right {
    font-size: 10px;
    color: #789;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    font-weight: 600;
    flex-shrink: 0;
  }

  .rec-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .rec-card {
    display: flex;
    gap: 12px;
    padding: 10px;
    background: #1B2028;
    border-radius: 8px;
    text-decoration: none;
    color: inherit;
    transition: all 0.15s;
    border: 1px solid transparent;
    position: relative;
  }

  .rec-card.score-high-card {
    border-color: rgba(0, 224, 84, 0.42);
    box-shadow: inset 0 0 0 1px rgba(0, 224, 84, 0.08);
  }

  .rec-card.score-mid-card {
    border-color: rgba(255, 140, 0, 0.5);
    box-shadow: inset 0 0 0 1px rgba(255, 140, 0, 0.1);
  }

  .rec-card.score-low-card {
    border-color: rgba(112, 170, 255, 0.45);
    box-shadow: inset 0 0 0 1px rgba(112, 170, 255, 0.12);
  }

  .rec-card:hover {
    background: #212830;
    border-color: #2C3641;
  }

  .rec-poster {
    width: 54px;
    height: 81px;
    border-radius: 4px;
    object-fit: cover;
    flex-shrink: 0;
  }

  .rec-poster-wrap {
    position: relative;
    width: 54px;
    height: 81px;
    flex-shrink: 0;
    border-radius: 4px;
    overflow: hidden;
  }

  .rec-poster-placeholder {
    width: 100%;
    height: 100%;
    border-radius: 4px;
    background: #2C3440;
    display: flex;
    align-items: center;
    justify-content: center;
  }


  .rec-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    /* Keep text clear of top-right score pill and bottom-right watchlist button */
    padding-right: 28px;
    padding-bottom: 8px;
  }

  .rec-title-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
    padding-right: 22px; /* tighter reserve for score pill */
  }

  .rec-title {
    font-size: 14px;
    color: #fff;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .rec-title-year {
    color: #9ab;
    font-weight: 600;
  }

  .rec-score-pill {
    font-size: 10px;
    font-weight: 700;
    font-family: inherit;
    background: rgba(120, 153, 170, 0.16);
    color: #9AB;
    padding: 2px 7px;
    border-radius: 10px;
    border: 1px solid transparent;
    line-height: 1.4;
    cursor: pointer;
    transition: all 0.15s;
    position: absolute;
    top: 8px;
    right: 8px;
  }

  .rec-score-pill:hover {
    background: rgba(120, 153, 170, 0.26);
    border-color: #9AB;
  }

  .rec-score-pill.band-high {
    background: rgba(0, 224, 84, 0.24);
    color: #00ff66;
    border-color: rgba(0, 224, 84, 0.55);
  }

  .rec-score-pill.band-high:hover {
    background: rgba(0, 224, 84, 0.34);
    border-color: #00ff66;
  }

  .rec-score-pill.band-mid {
    background: rgba(255, 140, 0, 0.25);
    color: #ff9c00;
    border-color: rgba(255, 140, 0, 0.58);
  }

  .rec-score-pill.band-mid:hover {
    background: rgba(255, 140, 0, 0.35);
    border-color: #ff9c00;
  }

  .rec-score-pill.band-low {
    background: rgba(112, 170, 255, 0.22);
    color: #8fc0ff;
    border-color: rgba(112, 170, 255, 0.52);
  }

  .rec-score-pill.band-low:hover {
    background: rgba(112, 170, 255, 0.32);
    border-color: #8fc0ff;
  }

  .rec-meta {
    font-size: 11px;
    color: #678;
  }

  .rec-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 3px;
  }

  .badge {
    font-size: 9.5px;
    padding: 2px 6px;
    border-radius: 8px;
    font-weight: 500;
  }

  .badge.watchlist {
    background: rgba(64, 188, 244, 0.15);
    color: #40BCF4;
  }

  .badge.source {
    background: #2C3440;
    color: #789;
  }

  .rec-because {
    font-size: 11px;
    color: #567;
    margin-top: 2px;
    line-height: 1.3;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }


  /* ── Watchlist button ── */
  .wl-btn {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 1px solid #2C3641;
    background: transparent;
    color: #789;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: all 0.15s;
    position: absolute;
    bottom: 10px;
    right: 10px;
  }

  .wl-btn:hover:not(:disabled) {
    border-color: #40BCF4;
    color: #40BCF4;
    background: rgba(64, 188, 244, 0.1);
  }

  .jw-btn {
    bottom: 38px;
    color: #8ca2b3;
    border-color: #33414f;
  }

  .jw-btn:hover:not(:disabled) {
    border-color: #f0c95a;
    color: #f0c95a;
    background: rgba(240, 201, 90, 0.14);
  }

  .tip::after {
    content: attr(data-tip);
    position: absolute;
    right: 0;
    bottom: calc(100% + 6px);
    padding: 4px 7px;
    border-radius: 6px;
    background: #0D1117;
    border: 1px solid #2C3641;
    color: #C8D5DE;
    font-size: 10px;
    line-height: 1.2;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transform: translateY(2px);
    transition: opacity 80ms ease-out, transform 80ms ease-out;
    z-index: 20;
  }

  .tip:hover::after {
    opacity: 1;
    transform: translateY(0);
  }

  .wl-btn.wl-added {
    border-color: rgba(0, 224, 84, 0.3);
    cursor: default;
    width: 20px;
    height: 20px;
  }

  .wl-btn.wl-loading {
    border-color: #2C3641;
    cursor: wait;
  }

  .wl-btn.wl-opened {
    border-color: #2C3641;
    cursor: default;
  }

  .wl-spinner {
    width: 10px;
    height: 10px;
    border: 1.5px solid rgba(120, 153, 170, 0.3);
    border-top-color: #789;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
</style>
