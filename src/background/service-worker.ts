import type { MessageToBackground } from '../types/messages';
import type { ScrapedFilm, UserProfile } from '../types/letterboxd';
import { getSettings, saveSettings } from '../lib/storage/settings-store';
import { getProfile, updateProfileFilms, saveProfile } from '../lib/storage/profile-store';
import { getCachedRecommendations, cacheRecommendations } from '../lib/storage/cache-store';
import { generateRecommendations, generateSingleSeedRecommendations } from '../lib/engine/recommendation-engine';
import {
  isTmdbConfigured,
  requiresUserTmdbKey,
} from '../lib/api/tmdb-client';
import { parseFilmsFromHTML, parsePaginationFromHTML } from '../content/scraper/pagination';
import { getProfilePageUrl, letterboxdFilmUrl } from '../lib/utils/url-utils';
import { resolveCanonicalFilmSlug } from '../lib/utils/letterboxd-slug-resolver';
import { canonicalizeRecommendationUrls } from '../lib/utils/recommendation-url-canonicalizer';
import { withStorageLock } from '../lib/storage/storage-mutex';
import { ensureCacheSchemaMetadata } from '../lib/storage/cache-schema';
import { debugWarn } from '../lib/utils/debug-log';

const APP_WINDOW_URL = chrome.runtime.getURL('src/popup/index.html?mode=window');
const APP_WINDOW_URL_MATCH = chrome.runtime.getURL('src/popup/index.html*');
const APP_WINDOW_BOUNDS_KEY = 'lb_rec_app_window_bounds';
const APP_WINDOW_MIN_WIDTH = 380;
const APP_WINDOW_MIN_HEIGHT = 560;
const APP_WINDOW_DEFAULT_BOUNDS = { width: 420, height: 760 };
const BOUNDS_SAVE_DEBOUNCE_MS = 220;

// In-flight recommendation generation tracking.
// Maps lowercase username → Promise of the generation result.
// Survives across message handler calls but NOT service worker restarts.
const inFlightGenerations = new Map<string, Promise<unknown>>();
let appWindowId: number | null = null;
let boundsSaveTimer: ReturnType<typeof setTimeout> | null = null;

// Storage key for the "generating" flag (survives service worker restarts).
// NOTE: This is a single global flag (one username at a time). This is
// intentional — Lekkerboxd only tracks one Letterboxd user per browser,
// so there's no need for per-user concurrent generation tracking.
const GENERATING_FLAG_KEY = 'lb_rec_generating';
const MAX_GENERATION_TIME = 5 * 60 * 1000; // 5 minutes safety timeout
const SERVICE_HEALTH_KEY = 'lb_rec_service_health';
const SERVICE_HEALTH_TTL = 30 * 60 * 1000; // 30 minutes
const SCORING_MODEL_VERSION = 'score-v2';

type ServiceHealthStatus = 'normal' | 'degraded';
interface ServiceHealthState {
  status: ServiceHealthStatus;
  reason: string | null;
  updatedAt: number;
}

// Initialize cache schema metadata for future migrations.
void ensureCacheSchemaMetadata().catch((err) => {
  debugWarn('Cache schema metadata initialization failed', err);
});

function coercePositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : null;
}

async function getSavedAppWindowBounds(): Promise<chrome.windows.CreateData> {
  const result = await chrome.storage.local.get(APP_WINDOW_BOUNDS_KEY);
  const raw = result[APP_WINDOW_BOUNDS_KEY] as {
    width?: number;
    height?: number;
    left?: number;
    top?: number;
  } | undefined;

  const width = Math.max(APP_WINDOW_MIN_WIDTH, coercePositiveInt(raw?.width) ?? APP_WINDOW_DEFAULT_BOUNDS.width);
  const height = Math.max(APP_WINDOW_MIN_HEIGHT, coercePositiveInt(raw?.height) ?? APP_WINDOW_DEFAULT_BOUNDS.height);
  const createData: chrome.windows.CreateData = {
    width,
    height,
    type: 'popup',
    focused: true,
  };

  if (typeof raw?.left === 'number' && Number.isFinite(raw.left)) createData.left = Math.round(raw.left);
  if (typeof raw?.top === 'number' && Number.isFinite(raw.top)) createData.top = Math.round(raw.top);
  return createData;
}

async function saveAppWindowBounds(windowId: number): Promise<void> {
  try {
    const win = await chrome.windows.get(windowId);
    if (win.state !== 'normal') return;
    if (!win.width || !win.height) return;
    await chrome.storage.local.set({
      [APP_WINDOW_BOUNDS_KEY]: {
        width: Math.max(APP_WINDOW_MIN_WIDTH, win.width),
        height: Math.max(APP_WINDOW_MIN_HEIGHT, win.height),
        left: win.left,
        top: win.top,
      },
    });
  } catch {
    // Window may have closed; ignore.
  }
}

function scheduleBoundsSave(windowId: number): void {
  if (boundsSaveTimer) clearTimeout(boundsSaveTimer);
  boundsSaveTimer = setTimeout(() => {
    void saveAppWindowBounds(windowId);
  }, BOUNDS_SAVE_DEBOUNCE_MS);
}

async function findAppWindowIds(): Promise<number[]> {
  const tabs = await chrome.tabs.query({ url: APP_WINDOW_URL_MATCH });
  return Array.from(
    new Set(
      tabs
        .map(tab => tab.windowId)
        .filter((id): id is number => typeof id === 'number'),
    ),
  );
}

async function focusAppWindow(windowId: number): Promise<void> {
  try {
    const win = await chrome.windows.get(windowId);
    const updateData: chrome.windows.UpdateInfo = { focused: true };
    if (win.state === 'minimized') updateData.state = 'normal';
    await chrome.windows.update(windowId, updateData);
  } catch {
    // Window may no longer exist.
  }
}

async function openOrFocusAppWindow(): Promise<void> {
  const existingWindowIds = await findAppWindowIds();
  if (existingWindowIds.length > 0) {
    const [primary, ...duplicates] = existingWindowIds;
    appWindowId = primary;
    await focusAppWindow(primary);
    await Promise.all(duplicates.map(id => chrome.windows.remove(id).catch(() => undefined)));
    return;
  }

  const createData = await getSavedAppWindowBounds();
  const win = await chrome.windows.create({
    ...createData,
    url: APP_WINDOW_URL,
  });
  if (typeof win.id === 'number') {
    appWindowId = win.id;
    scheduleBoundsSave(win.id);
  }
}

chrome.windows.onBoundsChanged.addListener((window) => {
  if (typeof window.id !== 'number') return;
  if (window.id !== appWindowId) return;
  scheduleBoundsSave(window.id);
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId !== appWindowId) return;
  appWindowId = null;
});

void findAppWindowIds()
  .then(async (ids) => {
    if (ids.length === 0) return;
    const [primary, ...duplicates] = ids;
    appWindowId = primary;
    await Promise.all(duplicates.map(id => chrome.windows.remove(id).catch(() => undefined)));
  })
  .catch(() => undefined);

async function setGeneratingFlag(username: string): Promise<void> {
  await chrome.storage.local.set({
    [GENERATING_FLAG_KEY]: { username: username.toLowerCase(), startedAt: Date.now() },
  });
}

async function clearGeneratingFlag(): Promise<void> {
  await chrome.storage.local.remove(GENERATING_FLAG_KEY);
}

async function getGeneratingFlag(): Promise<{ username: string; startedAt: number } | null> {
  const result = await chrome.storage.local.get(GENERATING_FLAG_KEY);
  const flag = result[GENERATING_FLAG_KEY] as { username: string; startedAt: number } | undefined;
  if (!flag) return null;

  // Auto-clear stale flags (generation likely crashed or service worker restarted)
  if (Date.now() - flag.startedAt > MAX_GENERATION_TIME) {
    await clearGeneratingFlag();
    return null;
  }

  return flag;
}

async function setServiceHealth(status: ServiceHealthStatus, reason: string | null): Promise<void> {
  await chrome.storage.local.set({
    [SERVICE_HEALTH_KEY]: {
      status,
      reason,
      updatedAt: Date.now(),
    } satisfies ServiceHealthState,
  });
}

async function getServiceHealth(): Promise<ServiceHealthState> {
  const result = await chrome.storage.local.get(SERVICE_HEALTH_KEY);
  const state = result[SERVICE_HEALTH_KEY] as ServiceHealthState | undefined;
  if (!state) return { status: 'normal', reason: null, updatedAt: Date.now() };

  // Auto-recover stale degraded markers.
  if (state.status === 'degraded' && Date.now() - state.updatedAt > SERVICE_HEALTH_TTL) {
    await setServiceHealth('normal', null);
    return { status: 'normal', reason: null, updatedAt: Date.now() };
  }
  return state;
}

// Valid message types that the service worker accepts
const VALID_MESSAGE_TYPES = new Set([
  'SCRAPED_PAGE',
  'SCRAPE_PROFILE',
  'GET_RECOMMENDATIONS',
  'GET_FILM_RECOMMENDATIONS',
  'GET_SETTINGS',
  'SAVE_SETTINGS',
  'OPEN_APP_WINDOW',
  'GET_PROFILE',
  'LOGGED_IN_USER',
  'ADD_TO_WATCHLIST',
  'OPEN_LETTERBOXD_FILM',
  'GET_GENERATING_STATUS',
  'GET_SERVICE_HEALTH',
]);

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message: MessageToBackground, sender, sendResponse) => {
  // Only accept messages from our own extension
  if (sender.id !== chrome.runtime.id) {
    sendResponse({ type: 'ERROR', error: 'Unauthorized sender' });
    return true;
  }

  // Validate message type
  if (!message?.type || !VALID_MESSAGE_TYPES.has(message.type)) {
    sendResponse({ type: 'ERROR', error: 'Invalid message type' });
    return true;
  }

  // Content script messages must come from letterboxd.com tabs
  const contentScriptTypes = new Set(['SCRAPED_PAGE', 'GET_FILM_RECOMMENDATIONS', 'LOGGED_IN_USER']);
  if (contentScriptTypes.has(message.type) && sender.tab?.url) {
    const url = new URL(sender.tab.url);
    if (url.hostname !== 'letterboxd.com' && !url.hostname.endsWith('.letterboxd.com')) {
      sendResponse({ type: 'ERROR', error: 'Invalid origin for content script message' });
      return true;
    }
  }

  handleMessage(message, sender).then(sendResponse).catch(err => {
    sendResponse({ type: 'ERROR', error: err.message || String(err) });
  });
  return true; // Keep channel open for async response
});

async function handleMessage(
  message: MessageToBackground,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  switch (message.type) {
    case 'SCRAPED_PAGE':
      return handleScrapedPage(message);

    case 'SCRAPE_PROFILE':
      return handleScrapeProfile(message.username);

    case 'GET_RECOMMENDATIONS':
      return handleGetRecommendations(message.username, message.forceRefresh);

    case 'GET_FILM_RECOMMENDATIONS':
      return handleFilmRecommendations(
        message.filmSlug,
        message.filmTitle,
        message.filmYear,
        sender.tab?.id,
      );

    case 'GET_SETTINGS':
      return getSettings();

    case 'SAVE_SETTINGS':
      return saveSettings(message.settings);

    case 'OPEN_APP_WINDOW':
      await openOrFocusAppWindow();
      return { ok: true };

    case 'GET_PROFILE':
      return getProfile(message.username);

    case 'LOGGED_IN_USER':
      console.log(`[LB Recs BG] Detected logged-in user: ${message.username}`);
      await saveSettings({ letterboxdUsername: message.username });
      return { ok: true };

    case 'ADD_TO_WATCHLIST':
      return handleAddToWatchlist(message.filmSlug, message.filmTitle, message.filmYear);

    case 'OPEN_LETTERBOXD_FILM':
      return handleOpenLetterboxdFilm(
        message.tmdbId,
        message.filmSlug,
        message.filmTitle,
        message.filmYear,
      );

    case 'GET_GENERATING_STATUS':
      return getGeneratingFlag();

    case 'GET_SERVICE_HEALTH':
      return getServiceHealth();

    default:
      return { error: 'Unknown message type' };
  }
}

async function handleScrapedPage(message: {
  username: string;
  films: ScrapedFilm[];
  pageType: 'films' | 'likes' | 'ratings' | 'watchlist';
  page: number;
  totalPages: number;
}): Promise<void> {
  // Use username from the content script (extracted from the URL)
  const username = message.username;
  if (!username) return;

  // Auto-save the username to settings so popup knows about it
  await saveSettings({ letterboxdUsername: username });

  console.log(`[LB Recs BG] Storing ${message.films.length} ${message.pageType} films for ${username} (page ${message.page}/${message.totalPages})`);

  await updateProfileFilms(username, message.pageType, message.films);

  // If there are more pages, fetch them in the background
  if (message.page < message.totalPages) {
    fetchRemainingPages(username, message.pageType, message.page + 1, message.totalPages);
  }
}

async function fetchRemainingPages(
  username: string,
  pageType: 'films' | 'likes' | 'ratings' | 'watchlist',
  startPage: number,
  totalPages: number,
): Promise<void> {
  const section = pageType === 'likes' ? 'likes/films' :
    pageType === 'ratings' ? 'films/ratings' :
    pageType === 'watchlist' ? 'watchlist' : 'films';

  for (let page = startPage; page <= totalPages; page++) {
    try {
      const url = getProfilePageUrl(username, section, page);
      const response = await fetch(url);
      if (!response.ok) continue;

      const html = await response.text();
      const films = parseFilmsFromHTML(html);

      if (films.length > 0) {
        await updateProfileFilms(username, pageType, films);
      }

      // Rate limit: 1 page per 2 seconds
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch {
      // Continue with next page on error
    }
  }
}

async function handleScrapeProfile(username: string): Promise<{ status: string }> {
  const settings = await getSettings();
  await saveSettings({ letterboxdUsername: username });

  // Clear persisted watchlist adds — the fresh scan will include them in profile.watchlist
  await chrome.storage.local.remove(WATCHLIST_ADDS_KEY);

  const sections = [
    { type: 'films' as const, section: 'films' as const },
    { type: 'ratings' as const, section: 'films/ratings' as const },
    { type: 'likes' as const, section: 'likes/films' as const },
    { type: 'watchlist' as const, section: 'watchlist' as const },
  ];
  let sectionsWithData = 0;
  let sectionRequestFailures = 0;

  for (const { type, section } of sections) {
    try {
      const url = getProfilePageUrl(username, section);
      const response = await fetch(url);
      if (!response.ok) {
        sectionRequestFailures += 1;
        continue;
      }

      const html = await response.text();
      const films = parseFilmsFromHTML(html);
      const totalPages = parsePaginationFromHTML(html);

      if (films.length > 0) {
        await updateProfileFilms(username, type, films);
        sectionsWithData += 1;
      }

      // Fetch remaining pages
      if (totalPages > 1) {
        await fetchRemainingPages(username, type, 2, totalPages);
      }
    } catch {
      // Continue with next section
      sectionRequestFailures += 1;
    }
  }

  if (sectionsWithData === 0) {
    const reason = sectionRequestFailures > 0
      ? 'Letterboxd profile fetch is failing; using cached data where available.'
      : 'Letterboxd page parsing may have changed; using cached data where available.';
    await setServiceHealth('degraded', reason);
  } else {
    await setServiceHealth('normal', null);
  }

  return { status: 'complete' };
}

/**
 * Build a fingerprint string from the settings and profile state that affect
 * recommendation output. If nothing in this fingerprint has changed, the
 * cached results are still valid and we can skip the expensive regeneration.
 */
function buildFingerprint(
  settings: { maxSeeds: number; maxRecommendations: number; popularityFilter: number },
  profileScrapedAt: number,
): string {
  return `${settings.maxSeeds}:${settings.maxRecommendations}:${settings.popularityFilter}:${profileScrapedAt}:${SCORING_MODEL_VERSION}`;
}

async function handleGetRecommendations(
  username: string,
  forceRefresh?: boolean,
): Promise<unknown> {
  const settings = await getSettings();
  if (!isTmdbConfigured(settings.tmdbApiKey)) {
    return {
      type: 'ERROR',
      error: requiresUserTmdbKey()
        ? 'TMDb is not configured for this GitHub build. Open Settings and add your TMDb API key.'
        : 'TMDb is not configured. Add your TMDb key in settings to use direct mode.',
    };
  }

  // Non-force path (popup reopening) — just return cache
  if (!forceRefresh) {
    const cached = await getCachedRecommendations(username);
    if (cached) {
      const { changed } = await canonicalizeRecommendationUrls(cached, async (rec, currentSlug) => (
        resolveCanonicalFilmSlugCached(
          rec.tmdbId,
          currentSlug,
          rec.title,
          rec.year > 0 ? rec.year : undefined,
        )
      ));
      if (changed) {
        await cacheRecommendations(cached);
      }
      return { type: 'RECOMMENDATIONS_READY', result: cached };
    }
    return null;
  }

  // Force-refresh path — deduplicate in-flight generations
  const generationPromise = ensureGenerationStarted(username, settings);
  return generationPromise;
}

function ensureGenerationStarted(
  username: string,
  settings: Awaited<ReturnType<typeof getSettings>>,
): Promise<unknown> {
  const key = username.toLowerCase();
  const existing = inFlightGenerations.get(key);
  if (existing) return existing;

  const generationPromise = executeGeneration(username, settings);
  inFlightGenerations.set(key, generationPromise);
  void generationPromise.finally(() => {
    inFlightGenerations.delete(key);
  });
  return generationPromise;
}

/**
 * The actual recommendation generation logic. Sets/clears the storage flag
 * so the popup can detect in-flight work even after a service worker restart.
 */
async function executeGeneration(
  username: string,
  settings: Awaited<ReturnType<typeof getSettings>>,
): Promise<unknown> {
  await setGeneratingFlag(username);

  try {
    // Get profile
    let profile = await getProfile(username);
    if (!profile || profile.watchedFilms.length === 0) {
      await handleScrapeProfile(username);
      profile = await getProfile(username);
    }

    if (!profile || (profile.ratedFilms.length === 0 && profile.likedFilms.length === 0)) {
      return {
        type: 'ERROR',
        error: `No rated or liked films found for "${username}". Visit their Letterboxd profile first.`,
      };
    }

    // Smart refresh: skip regeneration if settings + profile haven't changed
    const cached = await getCachedRecommendations(username);
    if (cached) {
      const currentFingerprint = buildFingerprint(
        {
          maxSeeds: settings.maxSeeds || 15,
          maxRecommendations: settings.maxRecommendations || 20,
          popularityFilter: settings.popularityFilter ?? 1,
        },
        profile.scrapedAt,
      );
      if (cached.settingsFingerprint === currentFingerprint) {
        const { changed } = await canonicalizeRecommendationUrls(cached, async (rec, currentSlug) => (
          resolveCanonicalFilmSlugCached(
            rec.tmdbId,
            currentSlug,
            rec.title,
            rec.year > 0 ? rec.year : undefined,
          )
        ));
        if (changed) {
          await cacheRecommendations(cached);
        }
        return { type: 'RECOMMENDATIONS_READY', result: cached };
      }
    }

    // Generate recommendations
    const result = await generateRecommendations(profile, settings.tmdbApiKey, undefined, {
      maxSeeds: settings.maxSeeds || 15,
      maxRecommendations: settings.maxRecommendations || 20,
      popularityFilter: settings.popularityFilter ?? 1,
    });

    await canonicalizeRecommendationUrls(result, async (rec, currentSlug) => (
      resolveCanonicalFilmSlugCached(
        rec.tmdbId,
        currentSlug,
        rec.title,
        rec.year > 0 ? rec.year : undefined,
      )
    ));

    // Stamp with fingerprint for future comparisons
    result.settingsFingerprint = buildFingerprint(
      {
        maxSeeds: settings.maxSeeds || 15,
        maxRecommendations: settings.maxRecommendations || 20,
        popularityFilter: settings.popularityFilter ?? 1,
      },
      profile.scrapedAt,
    );

    // Cache after fingerprint is set
    await cacheRecommendations(result);

    return { type: 'RECOMMENDATIONS_READY', result };
  } finally {
    await clearGeneratingFlag();
  }
}

async function handleFilmRecommendations(
  filmSlug: string,
  filmTitle: string,
  filmYear: number | null,
  tabId?: number,
): Promise<void> {
  const settings = await getSettings();
  if (!tabId || !isTmdbConfigured(settings.tmdbApiKey)) return;

  try {
    const seed: ScrapedFilm = {
      slug: filmSlug,
      title: filmTitle,
      year: filmYear,
      rating: 5,
      liked: true,
      reviewed: false,
      posterUrl: null,
      letterboxdUrl: letterboxdFilmUrl(filmSlug),
    };

    const username = settings.letterboxdUsername?.trim() ?? '';
    const profile = username ? await getProfile(username) : null;
    const watchedFilms = ensureSeedPresentInWatched(profile?.watchedFilms ?? [], seed);
    const overlayProfile: UserProfile = profile
      ? { ...profile, watchedFilms }
      : {
        username,
        scrapedAt: Date.now(),
        watchedFilms,
        likedFilms: [],
        ratedFilms: [],
        watchlist: [],
      };

    const result = await generateSingleSeedRecommendations(
      overlayProfile,
      settings.tmdbApiKey,
      seed,
      undefined,
      {
        maxRecommendations: 8,
        popularityFilter: settings.popularityFilter ?? 1,
      },
    );

    if (result.recommendations.length > 0) {
      await chrome.tabs.sendMessage(tabId, {
        type: 'RECOMMENDATIONS_READY',
        result,
      }).catch(() => undefined);
    }
  } catch {
    // Film-specific recs are optional, fail silently
  }
}

function ensureSeedPresentInWatched(
  watchedFilms: ScrapedFilm[],
  seed: ScrapedFilm,
): ScrapedFilm[] {
  if (watchedFilms.some(film => film.slug === seed.slug)) return watchedFilms;
  return [seed, ...watchedFilms];
}

// ── Watchlist: slug → LID resolution ──

const LID_CACHE_KEY = 'lb_rec_lids';
const WATCHLIST_ADDS_KEY = 'lb_rec_watchlist_adds';
const CANONICAL_SLUG_CACHE_KEY = 'lb_rec_canonical_slug_cache';

interface CanonicalSlugCache {
  byTmdbId: Record<string, string>;
  bySlug: Record<string, string>;
}

async function getLidCache(): Promise<Record<string, string>> {
  const result = await chrome.storage.local.get(LID_CACHE_KEY);
  return (result[LID_CACHE_KEY] as Record<string, string>) ?? {};
}

async function getCanonicalSlugCache(): Promise<CanonicalSlugCache> {
  const result = await chrome.storage.local.get(CANONICAL_SLUG_CACHE_KEY);
  const cache = result[CANONICAL_SLUG_CACHE_KEY] as CanonicalSlugCache | undefined;
  return {
    byTmdbId: cache?.byTmdbId ?? {},
    bySlug: cache?.bySlug ?? {},
  };
}

async function resolveFilmLid(slug: string): Promise<string | null> {
  // Check cache first
  const cache = await getLidCache();
  if (cache[slug]) return cache[slug];

  try {
    const response = await fetch(`https://letterboxd.com/film/${slug}/`);
    if (!response.ok) return null;

    const html = await response.text();
    // Extract LID from: analytic_params['film_id'] = 'sGpi';
    const match = html.match(/analytic_params\['film_id'\]\s*=\s*'([^']+)'/);
    if (!match) return null;

    const lid = match[1];
    // Cache the mapping — serialized to avoid lost updates from concurrent resolves
    await withStorageLock(LID_CACHE_KEY, async () => {
      const freshCache = await getLidCache();
      freshCache[slug] = lid;
      await chrome.storage.local.set({ [LID_CACHE_KEY]: freshCache });
    });
    return lid;
  } catch {
    return null;
  }
}

async function resolveCanonicalFilmSlugCached(
  tmdbId: number,
  filmSlug: string,
  filmTitle?: string,
  filmYear?: number,
): Promise<string> {
  const cache = await getCanonicalSlugCache();
  const tmdbKey = String(tmdbId);
  if (cache.byTmdbId[tmdbKey]) return cache.byTmdbId[tmdbKey];
  if (cache.bySlug[filmSlug]) return cache.bySlug[filmSlug];

  const canonicalSlug = await resolveCanonicalFilmSlug(filmSlug, filmTitle, filmYear);
  await withStorageLock(CANONICAL_SLUG_CACHE_KEY, async () => {
    const fresh = await getCanonicalSlugCache();
    fresh.bySlug[filmSlug] = canonicalSlug;
    fresh.bySlug[canonicalSlug] = canonicalSlug;
    fresh.byTmdbId[tmdbKey] = canonicalSlug;
    await chrome.storage.local.set({ [CANONICAL_SLUG_CACHE_KEY]: fresh });
  });
  return canonicalSlug;
}

async function handleOpenLetterboxdFilm(
  tmdbId: number,
  filmSlug: string,
  filmTitle?: string,
  filmYear?: number,
): Promise<{ success: boolean; openedUrl: string }> {
  let slugToOpen = filmSlug;
  try {
    slugToOpen = await resolveCanonicalFilmSlugCached(tmdbId, filmSlug, filmTitle, filmYear);
  } catch {
    // Keep best-effort fallback slug.
  }

  const openedUrl = `https://letterboxd.com/film/${slugToOpen}/`;
  await chrome.tabs.create({ url: openedUrl });
  return { success: true, openedUrl };
}

async function handleAddToWatchlist(
  filmSlug: string,
  filmTitle?: string,
  filmYear?: number,
): Promise<{ success: boolean; error?: string }> {
  const canonicalSlug = await resolveCanonicalFilmSlug(filmSlug, filmTitle, filmYear);

  // Resolve the film's Letterboxd ID
  console.log(`[LB Recs BG] Watchlist: resolving LID for slug "${canonicalSlug}"`);
  const lid = await resolveFilmLid(canonicalSlug);
  if (!lid) {
    console.log(`[LB Recs BG] Watchlist: could not resolve LID, opening fallback`);
    await setServiceHealth('degraded', 'Letterboxd watchlist parser is degraded; opening film pages as fallback.');
    chrome.tabs.create({ url: `https://letterboxd.com/film/${canonicalSlug}/` });
    return { success: false, error: 'no-lid' };
  }
  console.log(`[LB Recs BG] Watchlist: resolved LID="${lid}" for slug "${canonicalSlug}"`);

  // Get CSRF token directly from cookies (no content script needed)
  let csrfToken: string | undefined;
  try {
    const cookie = await chrome.cookies.get({
      url: 'https://letterboxd.com',
      name: 'com.xk72.webparts.csrf',
    });
    csrfToken = cookie?.value;
  } catch (err) {
    console.error(`[LB Recs BG] Watchlist: failed to get CSRF cookie:`, err);
  }

  if (!csrfToken) {
    console.log(`[LB Recs BG] Watchlist: no CSRF token — user may not be logged in`);
    chrome.tabs.create({ url: `https://letterboxd.com/film/${canonicalSlug}/` });
    return { success: false, error: 'no-csrf' };
  }

  console.log(`[LB Recs BG] Watchlist: CSRF token found, making PATCH request`);

  try {
    const response = await fetch(
      `https://letterboxd.com/api/v0/me/watchlist/${lid}`,
      {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ inWatchlist: true }),
      },
    );

    console.log(`[LB Recs BG] Watchlist: PATCH response status=${response.status}`);
    if (response.ok) {
      // Persist the slug so the popup can restore the checkmark on reopen.
      // Serialized to prevent lost updates when multiple films are added quickly.
      await withStorageLock(WATCHLIST_ADDS_KEY, async () => {
        const stored = await chrome.storage.local.get(WATCHLIST_ADDS_KEY);
        const added: string[] = (stored[WATCHLIST_ADDS_KEY] as string[]) ?? [];
        // Store both requested + canonical slug to keep UI badges stable
        // across old/new recommendation URL variants.
        for (const slug of [filmSlug, canonicalSlug]) {
          if (!added.includes(slug)) added.push(slug);
        }
        await chrome.storage.local.set({ [WATCHLIST_ADDS_KEY]: added });
      });
      await setServiceHealth('normal', null);
      return { success: true };
    }
    // Auth failure — open film page as fallback
    if (response.status === 401 || response.status === 403) {
      chrome.tabs.create({ url: `https://letterboxd.com/film/${canonicalSlug}/` });
      return { success: false, error: 'not-authenticated' };
    }
    return { success: false, error: `http-${response.status}` };
  } catch (err) {
    console.error(`[LB Recs BG] Watchlist: PATCH request failed:`, err);
    await setServiceHealth('degraded', 'Letterboxd watchlist API is temporarily unavailable; opening film pages as fallback.');
    chrome.tabs.create({ url: `https://letterboxd.com/film/${canonicalSlug}/` });
    return { success: false, error: 'request-failed' };
  }
}
