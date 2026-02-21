# Lekkerboxd

Lekkerboxd is a Chrome extension that generates personalized movie recommendations from your Letterboxd activity.

## Install Channels

| Install source | Default TMDb mode | TMDb key required? | Best for |
|---|---|---|---|
| Chrome Web Store build | Lekkerboxd proxy (Cloudflare Worker) | No | Most users |
| GitHub build | Direct TMDb API only | Yes | Power users / self-managed installs |

If you install from GitHub and leave the TMDb key blank, recommendations will not run until you add your key in Settings.

## Chrome Web Store Quick Start

1. Install Lekkerboxd from the Chrome Web Store.
2. Click the Chrome puzzle icon and pin Lekkerboxd.
3. Visit Letterboxd while logged in so Lekkerboxd can detect your username.
4. Open Lekkerboxd and click `Scan Profile`.
5. Click `Get Recommendations`.

No TMDb key is required for Store builds unless you explicitly switch to direct mode.

## GitHub Quick Start (TMDb Key Required)

1. Download and unzip `Lekkerboxd-github.zip`.
2. Load it via `chrome://extensions` -> `Load unpacked`.
3. Open Lekkerboxd Settings.
4. Add your TMDb API key in `TMDb API key (required for GitHub build)`.
5. Scan profile and generate recommendations.

Get a TMDb key: [TMDb API settings](https://www.themoviedb.org/settings/api)

## Features

- Auto-detects your logged-in Letterboxd username.
- Scrapes watched, rated, liked, and watchlist films.
- Aggregates candidates from TMDb, Reddit, and Taste.io.
- Canonicalizes Letterboxd slugs before popup render for correct ambiguous-title links.
- Adds films to Letterboxd watchlist from the popup.
- Opens JustWatch links with region-aware routing.

## Build and Artifacts

- `npm run build:store` -> Store channel build (`dist-store/`)
- `npm run build:github` -> GitHub channel build (`dist-github/`)
- `npm run pack:store` -> `Lekkerboxd-store.zip`
- `npm run pack:github` -> `Lekkerboxd-github.zip`
- `npm run pack:all` -> both zip artifacts

## Development (Short)

Requirements:

- Node.js 20.x
- npm
- Chrome/Chromium

Recommended flow:

1. `nvm use`
2. `npm run doctor`
3. `npm run build:store` (or `npm run build:github`)
4. `npm test`

## Documentation

- Release history: `CHANGELOG.md`
- Privacy policy: `PRIVACY.md`
- Future planning: `PLAN.md`
- Store proxy maintainer docs: `cloudflare/tmdb-proxy/README.md`

## Troubleshooting

- `TMDb is not configured for this GitHub build`: add your TMDb key in Settings.
- Store proxy 403: verify Worker `ALLOWED_ORIGIN` matches `chrome-extension://<id>`.
- No username detected: open Letterboxd while logged in, then reopen popup.
- Stale recommendations: run `Scan Profile` or `Clear Cache`.
