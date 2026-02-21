# Lekkerboxd Privacy Policy

Last updated: February 21, 2026

Lekkerboxd reads public Letterboxd profile data (watched films, ratings, liked films, and watchlist) to generate personalized movie recommendations.

## Data storage

- Data is stored locally on your device using `chrome.storage.local`.
- Lekkerboxd does not maintain a central user-profile database.

## Third-party services

Lekkerboxd may contact:

- Letterboxd (profile pages and optional watchlist action)
- TMDb (metadata and recommendation candidates)
- Reddit and Taste.io (additional recommendation signals)
- JustWatch (only when you click to open availability links)

TMDb routing by distribution:

- Chrome Web Store build: default TMDb proxy (`lekkerboxd-tmdb-proxy.lekkerboxd.workers.dev`) unless you provide your own TMDb key.
- GitHub build: direct TMDb mode with a user-provided key.

## Data sharing and tracking

- Lekkerboxd does not sell user data.
- Lekkerboxd does not use analytics, telemetry, or ad tracking.
- Third-party providers receive only request data required to return recommendation results.

## Watchlist action and cookies

If you use "Add to Watchlist", Lekkerboxd uses your existing Letterboxd session and CSRF token locally to send that user-initiated request to Letterboxd.

## Data deletion

- In extension settings, click "Clear Cache" to remove local stored data.
- Uninstalling the extension removes extension-local data from Chrome.

## Permissions used

- `storage`: save settings and cache locally
- `tabs`: open user-requested pages (Letterboxd, JustWatch, docs)
- `cookies`: read Letterboxd CSRF cookie for user-triggered watchlist action
- Host permissions: `*.letterboxd.com`, `api.themoviedb.org`, `lekkerboxd-tmdb-proxy.lekkerboxd.workers.dev`, `reddit.com`, `taste.io`, `justwatch.com`

