<script lang="ts">
  import tmdbLogoShort from '../../static/tmdb-logo-short.svg';
  import { JUSTWATCH_REGION_GROUPS } from '../lib/constants/justwatch-regions';
  import { isGithubDistribution } from '../lib/config/distribution';

  interface Props {
    onSaved: () => void;
  }

  let { onSaved }: Props = $props();

  let letterboxdUsername = $state('');
  let tmdbApiKey = $state('');
  let launchMode = $state<'popup' | 'window'>('popup');
  let justWatchRegion = $state('auto');
  let maxSeeds = $state(15);
  let maxRecommendations = $state(20);
  let popularityFilter = $state(1);
  let scanning = $state(false);
  let showAdvanced = $state(false);
  let scanStatus = $state('');
  const githubDistribution = isGithubDistribution();

  async function loadSettings() {
    const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    letterboxdUsername = settings.letterboxdUsername || '';
    tmdbApiKey = settings.tmdbApiKey || '';
    launchMode = settings.launchMode || 'popup';
    justWatchRegion = settings.justWatchRegion || 'auto';
    maxSeeds = settings.maxSeeds ?? 15;
    maxRecommendations = settings.maxRecommendations ?? 20;
    popularityFilter = settings.popularityFilter ?? 1;
  }

  async function saveSetting(key: string, value: number) {
    await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: { [key]: value } });
    onSaved();
  }

  async function saveTmdbApiKey() {
    await chrome.runtime.sendMessage({
      type: 'SAVE_SETTINGS',
      settings: { tmdbApiKey: tmdbApiKey.trim() },
    });
    onSaved();
  }

  async function saveLaunchMode(mode: 'popup' | 'window') {
    launchMode = mode;
    await chrome.runtime.sendMessage({
      type: 'SAVE_SETTINGS',
      settings: { launchMode: mode },
    });
    onSaved();
  }

  async function saveJustWatchRegion(region: string) {
    justWatchRegion = region;
    await chrome.runtime.sendMessage({
      type: 'SAVE_SETTINGS',
      settings: { justWatchRegion: region },
    });
    onSaved();
  }

  async function openSelectedMode() {
    if (launchMode === 'popup') return;
    await chrome.runtime.sendMessage({
      type: 'OPEN_APP_WINDOW',
    });
  }

  async function scanProfile() {
    if (!letterboxdUsername) return;
    scanning = true;
    scanStatus = 'Scanning profile...';

    try {
      await chrome.runtime.sendMessage({
        type: 'SCRAPE_PROFILE',
        username: letterboxdUsername,
      });
      scanStatus = 'Profile scanned successfully!';
      onSaved();
    } catch (e) {
      scanStatus = 'Error scanning profile';
    } finally {
      scanning = false;
      setTimeout(() => { scanStatus = ''; }, 3000);
    }
  }

  async function clearCache() {
    await chrome.storage.local.clear();
    scanStatus = 'Cache cleared. Visit Letterboxd to re-detect your account.';
    letterboxdUsername = '';
    setTimeout(() => { scanStatus = ''; }, 3000);
  }

  function openScoringDoc() {
    chrome.tabs.create({
      url: chrome.runtime.getURL('src/scoring/index.html'),
    });
  }

  function openPrivacyPolicy() {
    chrome.tabs.create({
      url: chrome.runtime.getURL('src/privacy/index.html'),
    });
  }

  loadSettings();
</script>

  <div class="settings">
    <div class="account-info" class:empty={!letterboxdUsername}>
      <div class="account-row">
        <div class="account-meta">
          {#if letterboxdUsername}
            <span class="account-label">Logged in as</span>
            <a
              class="account-username"
              href="https://letterboxd.com/{letterboxdUsername}/"
              target="_blank"
              rel="noopener"
            >
              {letterboxdUsername}
            </a>
            <p class="hint">Auto-detected from Letterboxd</p>
          {:else}
            <p class="hint">
              Visit any Letterboxd page while logged in to auto-detect your account.
            </p>
          {/if}
        </div>
        <div class="account-actions">
          <button
            class="btn btn-secondary btn-sm"
            onclick={scanProfile}
            disabled={scanning || !letterboxdUsername}
          >
            {scanning ? 'Scanning...' : 'Scan Profile'}
          </button>
          <button class="btn btn-danger btn-sm" onclick={clearCache}>
            Clear Cache
          </button>
        </div>
      </div>
    </div>

    <div class="sliders">
      <div class="slider-group">
        <div class="slider-header">
          <span class="slider-label">Seed films</span>
          <span class="slider-value">{maxSeeds}</span>
        </div>
        <input
          type="range"
          min="5"
          max="30"
          step="1"
          bind:value={maxSeeds}
          onchange={() => saveSetting('maxSeeds', maxSeeds)}
        />
        <p class="slider-hint">Number of your top films used to find recommendations</p>
      </div>

      <div class="slider-group">
        <div class="slider-header">
          <span class="slider-label">Recommendations</span>
          <span class="slider-value">{maxRecommendations}</span>
        </div>
        <input
          type="range"
          min="5"
          max="30"
          step="1"
          bind:value={maxRecommendations}
          onchange={() => saveSetting('maxRecommendations', maxRecommendations)}
        />
        <p class="slider-hint">Number of recommendations to return</p>
      </div>
    </div>

  <div class="filter-section">
    <span class="filter-title">Popularity filter</span>
    <div class="filter-options">
      <button
        class="filter-btn"
        class:active={popularityFilter === 0}
        onclick={() => { popularityFilter = 0; saveSetting('popularityFilter', 0); }}
      >
        Off
      </button>
      <button
        class="filter-btn"
        class:active={popularityFilter === 1}
        onclick={() => { popularityFilter = 1; saveSetting('popularityFilter', 1); }}
      >
        Moderate
      </button>
      <button
        class="filter-btn"
        class:active={popularityFilter === 2}
        onclick={() => { popularityFilter = 2; saveSetting('popularityFilter', 2); }}
      >
        Aggressive
      </button>
      <button
        class="filter-btn"
        class:active={popularityFilter === 3}
        onclick={() => { popularityFilter = 3; saveSetting('popularityFilter', 3); }}
      >
        Hidden gems
      </button>
    </div>
    <p class="filter-hint">
      {#if popularityFilter === 0}
        No penalty for popular films
      {:else if popularityFilter === 1}
        Slightly penalizes mainstream blockbusters
      {:else if popularityFilter === 2}
        Heavily penalizes popular films
      {:else}
        Excludes films with over 5,000 TMDb votes
      {/if}
    </p>
  </div>

  <div class="advanced-wrap">
    <button
      class="advanced-toggle"
      class:open={showAdvanced}
      onclick={() => { showAdvanced = !showAdvanced; }}
    >
      <span>Advanced settings</span>
      <span class="advanced-caret">{showAdvanced ? '−' : '+'}</span>
    </button>
    {#if showAdvanced}
      <div class="slider-group advanced-card">
        <div class="slider-header">
          <span class="slider-label">Launch mode</span>
        </div>
        <div class="launch-options">
          <button class="launch-btn" class:active={launchMode === 'popup'} onclick={() => saveLaunchMode('popup')}>Dropdown</button>
          <button class="launch-btn" class:active={launchMode === 'window'} onclick={() => saveLaunchMode('window')}>Pop-out</button>
        </div>
        <p class="slider-hint">Default is attached dropdown. Choose pop-out to launch in its own window.</p>
        {#if launchMode === 'window'}
          <button class="btn btn-secondary launch-open-btn" onclick={openSelectedMode}>
            Open Pop-out
          </button>
        {/if}

        <div class="slider-header">
          <span class="slider-label">JustWatch region</span>
        </div>
        <select
          class="region-select"
          bind:value={justWatchRegion}
          onchange={(e) => saveJustWatchRegion((e.currentTarget as HTMLSelectElement).value)}
        >
          <option value="auto">Auto (from browser language)</option>
          {#each JUSTWATCH_REGION_GROUPS as group}
            <optgroup label={group.label}>
              {#each group.regions as region}
                <option value={region.code}>{region.label}</option>
              {/each}
            </optgroup>
          {/each}
        </select>
        <p class="slider-hint">Used by the eye button to open JustWatch in your country.</p>

        <div class="slider-header">
          <span class="slider-label">
            {githubDistribution ? 'TMDb API key (required for GitHub build)' : 'Direct TMDb API key (optional)'}
          </span>
        </div>
        <input
          type="password"
          class="proxy-input"
          placeholder={githubDistribution ? 'Required to fetch recommendations in GitHub build' : 'Only needed for direct TMDb mode'}
          bind:value={tmdbApiKey}
          onchange={saveTmdbApiKey}
          onblur={saveTmdbApiKey}
        />
        <p class="slider-hint">
          {#if githubDistribution}
            GitHub builds use direct TMDb mode only, so this key is required.
          {:else}
            Using your own key sends requests straight to TMDb and can avoid slowdowns if shared usage is high.
          {/if}
          <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener">Get a TMDb API key</a>.
        </p>
      </div>
    {/if}
  </div>

  <div class="doc-links">
    <button class="scoring-link" onclick={openScoringDoc}>
      <span class="scoring-link-text">How it works</span>
      <span class="scoring-link-arrow">&rarr;</span>
    </button>
    <button class="scoring-link privacy" onclick={openPrivacyPolicy}>
      <span class="scoring-link-text">Privacy policy</span>
      <span class="scoring-link-arrow">&rarr;</span>
    </button>
  </div>

  {#if scanStatus}
    <div class="status">{scanStatus}</div>
  {/if}

  <a class="tmdb-attr" href="https://www.themoviedb.org/" target="_blank" rel="noopener" title="Powered by TMDb">
    <span>Powered by</span>
    <img src={tmdbLogoShort} alt="TMDb" height="10" />
  </a>
</div>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-height: 100%;
  }

  .account-info {
    padding: 12px;
    background: #1B2028;
    border: 1px solid #2C3641;
    border-radius: 6px;
  }

  .account-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .account-meta {
    min-width: 0;
    flex: 1;
  }

  .account-actions {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    flex-shrink: 0;
    width: 106px;
  }

  .account-info.empty {
    background: #1B2028;
    border: 1px dashed #456;
  }

  .account-label {
    font-size: 10px;
    color: #789;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    display: block;
    margin-bottom: 4px;
  }

  .account-username {
    font-size: 16px;
    color: #00E054;
    font-weight: 700;
    text-decoration: none;
  }

  .account-username:hover {
    text-decoration: underline;
  }

  .hint {
    margin: 4px 0 0;
    font-size: 10px;
    color: #567;
  }

  .sliders {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 12px;
    background: #1B2028;
    border: 1px solid #2C3641;
    border-radius: 6px;
  }

  .slider-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .launch-options {
    display: flex;
    gap: 0;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid #2C3641;
  }

  .launch-btn {
    flex: 1;
    padding: 7px 4px;
    background: #14181C;
    border: none;
    color: #567;
    font-size: 10px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s;
    font-family: inherit;
    border-right: 1px solid #2C3641;
  }

  .launch-btn:last-child {
    border-right: none;
  }

  .launch-btn:hover:not(.active) {
    color: #9AB;
    background: #1B2028;
  }

  .launch-btn.active {
    background: #00E054;
    color: #fff;
  }

  .launch-open-btn {
    margin-top: 2px;
  }

  .advanced-wrap {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .advanced-toggle {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 8px 10px;
    border: 1px solid #2C3641;
    border-radius: 6px;
    background: #14181C;
    color: #9AB;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    font-family: inherit;
  }

  .advanced-toggle:hover {
    border-color: #3B4A58;
    color: #C7D6E2;
  }

  .advanced-toggle.open {
    border-color: #4D7A96;
  }

  .advanced-caret {
    color: #00E054;
    font-size: 14px;
    line-height: 1;
  }

  .advanced-card {
    padding: 10px;
    border: 1px solid #2C3641;
    border-radius: 6px;
    background: #14181C;
    gap: 10px;
  }

  .proxy-input {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border: 1px solid #2C3641;
    border-radius: 6px;
    background: #10151C;
    color: #DDE7EE;
    font-size: 12px;
    outline: none;
  }

  .region-select {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border: 1px solid #2C3641;
    border-radius: 6px;
    background: #10151C;
    color: #DDE7EE;
    font-size: 12px;
    outline: none;
    font-family: inherit;
  }

  .region-select:focus {
    border-color: #4D7A96;
  }

  .proxy-input:focus {
    border-color: #4D7A96;
  }

  .slider-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .slider-label {
    font-size: 11px;
    color: #9AB;
    font-weight: 600;
  }

  .slider-value {
    font-size: 13px;
    font-weight: 700;
    color: #00E054;
    min-width: 20px;
    text-align: right;
  }

  .slider-hint {
    margin: 0;
    font-size: 9px;
    color: #567;
  }

  .slider-hint a {
    color: #7FC7FF;
    text-decoration: none;
  }

  .slider-hint a:hover {
    text-decoration: underline;
  }

  input[type="range"] {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 4px;
    background: #2C3440;
    border-radius: 2px;
    outline: none;
    cursor: pointer;
  }

  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #00E054;
    border: none;
    cursor: pointer;
    transition: transform 0.1s;
  }

  input[type="range"]::-webkit-slider-thumb:hover {
    transform: scale(1.2);
  }

  input[type="range"]::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #00E054;
    border: none;
    cursor: pointer;
  }

  .filter-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px;
    background: #1B2028;
    border: 1px solid #2C3641;
    border-radius: 6px;
  }

  .filter-title {
    font-size: 11px;
    color: #9AB;
    font-weight: 600;
  }

  .filter-options {
    display: flex;
    gap: 0;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid #2C3641;
  }

  .filter-btn {
    flex: 1;
    padding: 6px 4px;
    background: #14181C;
    border: none;
    color: #567;
    font-size: 10px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
    font-family: inherit;
    border-right: 1px solid #2C3641;
  }

  .filter-btn:last-child { border-right: none; }

  .filter-btn:hover:not(.active) {
    color: #9AB;
    background: #1B2028;
  }

  .filter-btn.active {
    background: #00E054;
    color: #fff;
  }

  .filter-hint {
    margin: 0;
    font-size: 9px;
    color: #567;
  }

  .btn {
    padding: 8px 16px;
    border: none;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    font-weight: 600;
    transition: opacity 0.15s;
    flex: 1;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-secondary {
    background: #2C3440;
    color: #9AB;
  }

  .btn-secondary:hover:not(:disabled) { background: #3C4450; }

  .btn-danger {
    background: #3a1c1c;
    color: #FF8000;
  }

  .btn-danger:hover { background: #4a2c2c; }

  .btn-sm {
    padding: 5px 9px;
    font-size: 10px;
    border-radius: 5px;
    flex: 0 0 auto;
    width: 100%;
  }

  .doc-links {
    display: flex;
    gap: 8px;
  }

  .tmdb-attr {
    margin-top: auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    font-size: 10px;
    color: #567;
    text-decoration: none;
    opacity: 0.85;
    transition: color 0.15s, opacity 0.15s;
  }

  .tmdb-attr:hover {
    color: #9AB;
    opacity: 1;
  }

  .tmdb-attr img {
    display: block;
  }

  .scoring-link {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    flex: 1;
    padding: 10px 16px;
    background: #1B2028;
    border: 1px dashed #2C3641;
    border-radius: 6px;
    cursor: pointer;
    font-family: inherit;
    transition: all 0.15s;
  }

  .scoring-link:hover {
    border-color: #00E054;
    background: rgba(0, 224, 84, 0.04);
  }

  .scoring-link-text {
    font-size: 12px;
    font-weight: 600;
    color: #9AB;
    transition: color 0.15s;
  }

  .scoring-link:hover .scoring-link-text {
    color: #DEF;
  }

  .scoring-link-arrow {
    font-size: 13px;
    color: #00E054;
    transition: transform 0.15s;
  }

  .scoring-link:hover .scoring-link-arrow {
    transform: translateX(2px);
  }

  .status {
    font-size: 11px;
    color: #00E054;
    text-align: center;
    padding: 4px;
  }
</style>
