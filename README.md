# Lekkerboxd

Lekkerboxd is a Chrome extension that generates personalized movie recommendations from your Letterboxd activity.

## Install Paths (Important)

Lekkerboxd has two distribution channels with different TMDb behavior.

| Install source | Default TMDb mode | TMDb key required? | Best for |
|---|---|---|---|
| Chrome Web Store build | Lekkerboxd proxy (Cloudflare Worker) | No | Most users |
| GitHub build | Direct TMDb API only | Yes | Power users / self-managed installs |

If you install from GitHub and leave the TMDb key blank, recommendations will not run until you add your own key in Settings.

## Chrome Web Store Setup

1. Install the extension from the Chrome Web Store.
2. Visit Letterboxd while logged in so Lekkerboxd can detect your username.
3. Open Lekkerboxd and click `Scan Profile`.
4. Click `Get Recommendations`.

No TMDb key is required for this build unless you want to force direct mode.

## GitHub Setup (TMDb Key Required)

1. Download and load the GitHub artifact (`Lekkerboxd-github.zip` unpacked into `chrome://extensions`).
2. Open Lekkerboxd Settings.
3. Add your TMDb API key in `TMDb API key (required for GitHub build)`.
4. Scan profile and generate recommendations.

Get a TMDb key here: [TMDb API settings](https://www.themoviedb.org/settings/api)

## Why This Split Exists

This split is intentional:

- Store users get a low-friction experience (no key setup).
- GitHub users do not depend on the publisher proxy and must use their own TMDb key.
- This reduces public relay abuse risk and limits unexpected proxy costs.

## Features

- Auto-detects logged-in Letterboxd username.
- Scrapes watched, rated, liked, and watchlist films.
- Aggregates recommendation candidates from TMDb, Reddit, and Taste.io.
- Applies filtering + scoring with popularity controls.
- Keeps recommendation generation running in the background while popup is closed.
- Adds films to Letterboxd watchlist from the popup.
- Opens JustWatch links with region-aware routing.
- Includes in-extension docs:
  - How Lekkerboxd Works
  - Privacy Policy

## Build and Artifacts

- `npm run build:store` builds the Store channel behavior.
- `npm run build:github` builds the GitHub channel behavior.
- `npm run pack:store` produces `Lekkerboxd-store.zip`.
- `npm run pack:github` produces `Lekkerboxd-github.zip`.
- `npm run pack:all` builds and packs both artifacts.

## Channel Behavior (TMDb)

### Store channel

- Empty TMDb key: use default proxy (`https://lekkerboxd-tmdb-proxy.lekkerboxd.workers.dev`).
- User TMDb key present: switch to direct TMDb calls.

### GitHub channel

- Empty TMDb key: treated as not configured (clear settings error shown).
- User TMDb key present: direct TMDb calls only.
- Proxy host permission is removed from the built manifest.

## Development

Requirements:

- Node.js 20+ (20 LTS recommended)
- npm
- Chrome/Chromium browser

Commands:

- `npm run dev`
- `npm run ci:check:store`
- `npm run ci:check:github`
- `npm test`

## Project Structure

- `src/background/service-worker.ts`: orchestration, scraping, generation lifecycle, watchlist actions
- `src/lib/engine/recommendation-engine.ts`: candidate aggregation, filtering, scoring, ranking
- `src/lib/api/`: TMDb / Reddit / Taste.io clients
- `src/popup/`: popup UI and settings
- `src/scoring/`: How Lekkerboxd Works page
- `src/privacy/`: Privacy Policy page
- `cloudflare/tmdb-proxy/`: proxy worker source (Store channel infrastructure)

## Cloudflare Proxy Notes (Store channel maintainers)

Worker secrets:

- `TMDB_API_KEY`
- `ALLOWED_ORIGIN` (for example `chrome-extension://<published-extension-id>`)

Deploy:

1. `cd cloudflare/tmdb-proxy`
2. `npx wrangler secret put TMDB_API_KEY`
3. `npx wrangler secret put ALLOWED_ORIGIN`
4. `npx wrangler deploy`

## Privacy and Data

- Data is stored locally in `chrome.storage.local`.
- Letterboxd / Reddit / Taste.io calls are made from the extension.
- TMDb routing differs by channel as documented above.
- Watchlist add uses your logged-in Letterboxd session and CSRF token locally.

## Troubleshooting

- `TMDb is not configured for this GitHub build`: add your TMDb key in Settings.
- Proxy 403 in Store build: check Worker `ALLOWED_ORIGIN` matches `chrome-extension://<id>`.
- No username detected: open Letterboxd while logged in, then reopen popup.
- Stale recommendations: run `Scan Profile` or `Clear Cache`.

## Release Note Template

Use this template in releases:

1. Which artifact to download:
   - `Lekkerboxd-store.zip` (no TMDb key required)
   - `Lekkerboxd-github.zip` (TMDb key required)
2. Any behavior changes to scoring or recommendation pipeline.
3. Any proxy/deployment changes (Store channel only).
