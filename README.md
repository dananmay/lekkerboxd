# Lekkerboxd

Lekkerboxd is a Chrome extension that generates personalized movie recommendations from a user's Letterboxd activity.

It combines:
- Letterboxd profile scraping (watched, liked, rated, watchlist)
- TMDb recommendations + similar-film APIs
- Reddit and Taste.io recommendation signals
- A local scoring and filtering engine

Everything runs client-side in the extension. TMDb calls use a default Cloudflare Worker proxy for key protection and edge caching unless a user enables direct TMDb mode by entering their own TMDb key in Settings.

## Features

- Auto-detects logged-in Letterboxd username from Letterboxd pages
- Scans and caches profile sections:
  - Watched films
  - Rated films
  - Liked films
  - Watchlist
- Generates ranked recommendations with:
  - Multi-source hit tracking
  - Accuracy-tuned external-source sampling (Reddit + Taste.io) with capped TMDb title resolution
  - Confidence gating for external title-to-TMDb matches (strict title overlap + year check when available)
  - Retry/backoff on transient API failures (429/5xx/timeouts) with bounded request deadlines
  - Popularity filtering levels
  - Unified final score model: base score + capped seed boost (+10 max), with conditional normalization when boosted max exceeds 105
  - Watchlist badges
  - "Because you liked..." reasoning
- Adds films to Letterboxd watchlist from the popup
- Includes a JustWatch "Where to watch" button on each recommendation card to check regional streaming availability
- JustWatch region setting (Auto by browser language, or manual override using the full JustWatch-supported country list in Advanced settings)
- Launch modes: attached dropdown (default) or pop-out window
- Shows a compact recommendation overlay on Letterboxd film pages
- Includes in-extension docs:
  - Scoring explanation
  - Privacy policy

## Tech stack

- Svelte 5
- TypeScript
- Vite
- CRXJS (`@crxjs/vite-plugin`)
- Chrome Extension Manifest V3

## Project structure

- `src/background/service-worker.ts`
Background orchestration: messages, profile scraping, recommendation generation, caching, watchlist actions.

- `src/content/main.ts`
Content script: page scraping + film-page recommendation overlay.

- `src/lib/engine/recommendation-engine.ts`
Seed selection, source aggregation, dedupe, scoring, ranking.

- `src/lib/api/`
API clients for TMDb, Reddit, Taste.io.

- `cloudflare/tmdb-proxy/`
Cloudflare Worker that proxies TMDb requests, keeps the publisher TMDb key server-side, and adds edge caching.

- `src/lib/storage/`
Local storage wrappers for settings, profile data, recommendation cache, and cache schema metadata.

- `src/popup/`
Extension popup UI (settings, profile status, recommendations).

- `src/scoring/` and `src/privacy/`
User-facing in-extension documentation pages.

- `tests/`
Deterministic fixture-based tests for core utility/parser behavior.

## Requirements

- Node.js 18+ (Node 20 recommended)
- npm
- Chrome/Chromium browser for extension loading

## Getting started

1. Install dependencies:
`npm install`

2. Start development mode:
`npm run dev`

3. Build production bundle:
`npm run build`

4. Load the extension in Chrome:
1. Open `chrome://extensions`
2. Enable Developer mode
3. Click "Load unpacked"
4. Select `/Users/dhimant/Desktop/Claude Experiments/Letterboxd Recommendations/dist`

## Scripts

- `npm run dev`
Start Vite development workflow for the extension.

- `npm run build`
Build production output into `dist/`.

- `npm run preview`
Preview built output (standard Vite preview).

- `npm run check:privacy`
Verify privacy-policy text includes required permission and host disclosures from `manifest.json`.

- `npm run test:compile`
Compile tests to `.test-dist` and prepare test runtime metadata.

- `npm test`
Run compiled local deterministic tests.

- `npm run ci:check`
Run privacy check + build + tests.

## TMDb modes

The extension supports:
- Default proxy mode: uses `https://lekkerboxd-tmdb-proxy.lekkerboxd.workers.dev`
- Direct mode (optional): user provides their own TMDb API key in Settings

Mode selection logic:
- If `Direct TMDb API key` is empty: proxy mode is used automatically.
- If `Direct TMDb API key` is set: direct mode is used and overrides proxy mode.

Proxy behavior:
- TMDb requests are routed to Worker endpoints (`/v1/tmdb/...`)
- Worker uses `TMDB_API_KEY` as a secret
- Worker enforces strict extension-origin allowlisting via `ALLOWED_ORIGIN`
- Responses are edge-cached (`search` and `movie` TTLs)
- Duplicate in-flight requests are coalesced (both extension-side and worker-side)
- Worker supports both TMDb v4 Bearer token and v3 API key fallback

### 1. Deploy the Worker

From this repo:
- `cd cloudflare/tmdb-proxy`
- `npm install -g wrangler` (if needed)
- `wrangler secret put TMDB_API_KEY`
- `wrangler deploy`

Worker vars:
- `ALLOWED_ORIGIN` (required):
  - e.g. `chrome-extension://<your-extension-id>`
  - supports comma-separated allowlist if needed (for example dev + prod extension IDs)
  - do not include a trailing slash
  - extension proxy requests also send `X-Lekkerboxd-Origin: chrome-extension://<id>` for environments that omit `Origin`/`Referer`
- `CACHE_TTL_SEARCH_SECONDS` (default `600`)
- `CACHE_TTL_MOVIE_SECONDS` (default `21600`)

### 2. Configure the extension

In extension Settings:
- Leave `Direct TMDb API key` empty to use the default proxy
- Enter `Direct TMDb API key` only if you explicitly want direct mode

Notes:
- No bundled TMDb key is shipped in this extension.
- Direct mode overrides proxy mode whenever a user key is present.
- Default proxy URL is internal and not user-configurable in the UI.

## Quality checks (recommended before merging/publishing)

Run:
- `npm run ci:check`

Or run individually:
- `npm run check:privacy`
- `npm run build`
- `npm test`

## CI

GitHub Actions workflow:
- `.github/workflows/ci.yml`

Runs on push and pull requests:
1. `npm ci`
2. `npm run ci:check`

## Manifest permissions

Current `manifest.json` permissions:
- `storage`: persist settings/profile/recommendation caches
- `tabs`: open docs/fallback pages and send tab messages
- `cookies`: read Letterboxd CSRF cookie for watchlist actions

Host permissions:
- `*://*.letterboxd.com/*`
- `https://api.themoviedb.org/*`
- `https://lekkerboxd-tmdb-proxy.lekkerboxd.workers.dev/*` (default TMDb proxy)
- `https://www.justwatch.com/*` (Where to watch button validation + open)
- `https://www.reddit.com/*`
- `https://www.taste.io/*`

## Data and privacy model

- Data is stored locally using `chrome.storage.local`.
- Letterboxd/Reddit/Taste.io requests are sent directly from the extension.
- The JustWatch lookup opens in a new tab only when you click the eye button on a recommendation card.
- With `JustWatch region = Auto`, Lekkerboxd opens the US direct film page.
- With a manually selected JustWatch region, Lekkerboxd first tries that region's direct film page and falls back to that region's search page if needed.
- TMDb requests use the default proxy unless a user-provided TMDb key enables direct mode.
- In default proxy mode, Cloudflare receives normal request metadata required to serve requests (for example IP/user-agent), but not your full Letterboxd profile dataset.
- TMDb proxy backend is included under `cloudflare/tmdb-proxy/`.
- "Add to Watchlist" uses the user's existing Letterboxd authenticated session and CSRF token.
- Recommendation generation continues in the background via the service worker while the popup is closed.

See:
- `src/privacy/PrivacyPolicy.svelte`

## Caching strategy (high level)

- Profile cache TTL: 24 hours
- Recommendation cache TTL: 12 hours
- TMDb ID mappings cached locally
- External-title TMDb resolution is bounded to keep generation latency predictable
- External-source intake is capped per seed to reduce noisy fan-out paths
- External TMDb matches are accepted only when title confidence checks pass
- Per-key storage mutex added to reduce lost-update races for read-modify-write flows
- Cache schema metadata scaffolded for future migrations

## Known limitations

- Letterboxd URL matching is best-effort for ambiguous titles and can still depend on slug/title matching in edge cases.
- Third-party page structure/API behavior changes (Letterboxd/Reddit/Taste.io/TMDb) can impact results.
- Legal/compliance requirements for scraping and third-party API usage vary by provider and use case.

## Troubleshooting

- If profile is not detected:
  - Visit Letterboxd while logged in
  - Reopen popup

- If recommendations are stale:
  - Re-scan profile
  - Use "Clear Cache" in settings

- If watchlist add fails:
  - The extension opens the film page fallback on Letterboxd
  - Confirm you are logged in to Letterboxd

- If a “service degraded” banner appears:
  - Letterboxd scraping/watchlist endpoints may have changed temporarily
  - The extension will keep using cached profile/recommendation data where available
  - Watchlist actions may fall back to opening the film page directly

- If recommendations stop loading in proxy mode:
  - Verify Worker secret is named exactly `TMDB_API_KEY` with your key as its value
  - Run `npx wrangler secret list` and `npx wrangler deploy`
  - Confirm `ALLOWED_ORIGIN` matches your extension ID origin (`chrome-extension://<id>`)
  - If you see a 403 origin/referer error, re-run `wrangler secret put ALLOWED_ORIGIN` and redeploy

## Versioning and release notes

Current version is defined in:
- `manifest.json`
- `package.json`

Build output for release:
- `dist/`
