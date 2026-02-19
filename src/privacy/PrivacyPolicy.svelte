<script lang="ts">
  // Static document
</script>

<div class="doc">
  <header class="doc-header">
    <div class="brand">
      <span class="logo-dot"></span>
      <span class="logo-text">Lekkerboxd</span>
    </div>
    <h1>Privacy Policy</h1>
    <p class="subtitle">Last updated: February 19, 2026</p>
  </header>

  <section class="section">
    <h2>What data does Lekkerboxd collect?</h2>
    <p>
      Lekkerboxd reads your <strong>public Letterboxd profile</strong> data: your watched films,
      ratings, liked films, and watchlist. This data is used solely to generate personalized
      film recommendations.
    </p>
    <p>
      TMDb behavior depends on distribution channel. In the <strong>Chrome Web Store build</strong>,
      TMDb requests use the Lekkerboxd Cloudflare Worker proxy by default unless you provide your own
      TMDb key. In the <strong>GitHub build</strong>, your own TMDb key is required and requests go
      directly to TMDb.
    </p>
  </section>

  <section class="section">
    <h2>Where is my data stored?</h2>
    <p>
      All data is stored <strong>locally on your device</strong> using Chrome's
      <code>chrome.storage.local</code> API. Profile data, settings, and cached
      recommendations are not stored in any Lekkerboxd application database.
    </p>
  </section>

  <section class="section">
    <h2>What third-party services are contacted?</h2>
    <p>
      When generating recommendations, the extension contacts the following services:
    </p>
    <ul>
      <li><strong>Letterboxd</strong> — to scrape your public profile pages</li>
      <li><strong>TMDb (The Movie Database)</strong> — to resolve film IDs, fetch metadata, and get recommendation/similar film data</li>
      <li><strong>Reddit</strong> — to search film subreddits for human-curated recommendations</li>
      <li><strong>Taste.io</strong> — to fetch algorithmically similar films</li>
      <li><strong>JustWatch</strong> — only when you click the eye button to view regional streaming availability</li>
    </ul>
    <p>
      JustWatch links use your configured JustWatch region setting. Auto mode opens the US direct
      film page. Manual country mode first tries a direct page in that region and falls back to
      regional search when needed.
    </p>
    <p>
      Letterboxd, Reddit, and Taste.io requests are made directly from your browser.
      TMDb requests are routed via the Lekkerboxd Cloudflare Worker proxy in Store builds by default,
      or directly to TMDb when a user key is provided. GitHub builds always use direct TMDb mode with
      a user-provided key. Services receive only the film title queries required to find recommendations,
      not your full profile dataset.
    </p>
    <p>
      If you use the "Add to Watchlist" button, Lekkerboxd also sends a direct authenticated
      request to Letterboxd from your browser to add that specific film to your own watchlist.
      This uses your existing Letterboxd session cookie and CSRF token locally in the extension.
    </p>
  </section>

  <section class="section">
    <h2>Is my data shared with anyone?</h2>
    <p>
      Lekkerboxd does not use analytics, telemetry, or ad tracking. The extension does not
      submit your full Letterboxd profile to a Lekkerboxd database. Third-party API providers
      (and the TMDb proxy in default mode) receive only the request data needed to return
      recommendation results.
    </p>
    <p>
      In Store-build proxy mode, TMDb requests pass through Cloudflare infrastructure, which may
      process standard request metadata (such as IP address and user agent) to deliver and secure
      the service. GitHub builds do not depend on the Lekkerboxd proxy.
    </p>
    <p>
      If Letterboxd scraping or watchlist endpoints are temporarily unstable, the extension may
      enter a degraded mode that prefers cached data and fallback actions until normal behavior
      resumes.
    </p>
  </section>

  <section class="section">
    <h2>How do I delete my data?</h2>
    <p>
      Open the extension popup, click the gear icon to open Settings, and click
      <strong>Clear Cache</strong>. This removes all stored profile data, cached
      recommendations, and settings from your browser. You can also uninstall the
      extension, which automatically removes all stored data.
    </p>
  </section>

  <section class="section">
    <h2>Permissions</h2>
    <p>Lekkerboxd requests the following browser permissions:</p>
    <ul>
      <li><strong>storage</strong> — to save your settings and cached data locally</li>
      <li><strong>tabs</strong> — to open Letterboxd film pages and extension documentation when needed</li>
      <li><strong>cookies</strong> — to read your Letterboxd CSRF token cookie for watchlist actions you trigger</li>
      <li><strong>Host access to letterboxd.com</strong> — to read profile pages and perform watchlist actions</li>
      <li><strong>Host access to api.themoviedb.org</strong> — to fetch movie metadata and recommendation data</li>
      <li><strong>Host access to lekkerboxd-tmdb-proxy.lekkerboxd.workers.dev</strong> — Store build only, to reach the default Lekkerboxd Cloudflare TMDb proxy</li>
      <li><strong>Host access to justwatch.com</strong> — to validate and open JustWatch film/search pages when you click the eye button</li>
      <li><strong>Host access to reddit.com</strong> — to search Reddit for recommendation signals</li>
      <li><strong>Host access to taste.io</strong> — to fetch similar-film signals from Taste.io</li>
    </ul>
  </section>

  <section class="section">
    <h2>Changes to this policy</h2>
    <p>
      If this policy is updated, the changes will be included in a new version of the
      extension. The "last updated" date at the top of this page will reflect any changes.
    </p>
  </section>

  <footer class="doc-footer">
    <p>Lekkerboxd &middot; Built for film lovers who want to dig deeper</p>
  </footer>
</div>

<style>
  .doc {
    max-width: 680px;
    margin: 0 auto;
    padding: 32px 24px 48px;
  }

  .doc-header {
    text-align: center;
    margin-bottom: 32px;
    padding-bottom: 24px;
    border-bottom: 1px solid #2C3641;
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 16px;
  }

  .logo-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #00E054;
  }

  .logo-text {
    font-size: 14px;
    font-weight: 700;
    color: #789;
    letter-spacing: 1px;
    text-transform: uppercase;
  }

  .doc-header h1 {
    margin: 0 0 8px;
    font-size: 28px;
    font-weight: 700;
    color: #fff;
    line-height: 1.2;
  }

  .subtitle {
    margin: 0;
    font-size: 15px;
    color: #567;
  }

  .section {
    margin-bottom: 28px;
  }

  .section h2 {
    font-size: 16px;
    font-weight: 700;
    color: #DEF;
    margin: 0 0 10px;
    padding-bottom: 6px;
    border-bottom: 1px solid #2C3641;
  }

  .section p {
    margin: 0 0 10px;
    font-size: 14px;
    line-height: 1.65;
    color: #9AB;
  }

  .section strong {
    color: #DEF;
  }

  .section code {
    font-family: "SF Mono", "Fira Code", Menlo, monospace;
    font-size: 12px;
    background: #1B2028;
    padding: 2px 6px;
    border-radius: 3px;
    color: #00E054;
  }

  .section ul {
    margin: 8px 0 12px;
    padding-left: 20px;
  }

  .section li {
    font-size: 14px;
    line-height: 1.65;
    color: #9AB;
    margin-bottom: 4px;
  }

  .doc-footer {
    margin-top: 48px;
    padding-top: 20px;
    border-top: 1px solid #2C3641;
    text-align: center;
  }

  .doc-footer p {
    margin: 0;
    font-size: 12px;
    color: #456;
  }
</style>
