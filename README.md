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
- Runs film-page overlay recommendations as a single-seed query (current film): TMDb defines the candidate pool, and Reddit/Taste.io act as additional relevance signals with reduced fanout for speed.
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
- Build outputs are kept separate:
  - Store build output: `dist-store/`
  - GitHub build output: `dist-github/`
- To test unpacked builds locally:
  - Load `dist-store/` for Store behavior.
  - Load `dist-github/` for GitHub behavior.

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

- Node.js 20.x (enforced)
- npm
- Chrome/Chromium browser

Commands:

- `npm run dev`
- `npm run ci:check:store`
- `npm run ci:check:github`
- `npm test`

Build guardrails:

- `npm run doctor` checks:
  - Node version is exactly 20.x
  - duplicate `* 2` artifacts are not present
  - critical source/config files are not empty
- `npm run build:store` and `npm run build:github` now run `doctor` automatically before building.
- Builds are single-flight: a lock file prevents parallel build runs from different terminals.
- `npm run rebuild:store` and `npm run rebuild:github` perform a full clean reinstall + build flow:
  - remove `node_modules`, `dist*`, `.test-dist`
  - run `npm ci`
  - run one channel build

Recommended local workflow:

1. `nvm use` (reads `.nvmrc` -> Node 20)
2. `npm run doctor`
3. `npm run build:store` (or `npm run build:github`)

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

## Release History

See `CHANGELOG.md` for release-by-release history.

## Appendix: Legacy Implementation Plan (Historical)

Historical reference only. Active/future planning lives in `PLAN.md`.

## Overview
A Chrome extension that scrapes a user's liked/reviewed films from Letterboxd, then recommends movies using TMDb's API, Reddit's r/IfYouLikeBlank, and Google search results for "If I like [movie], what else would I like?"

## Tech Stack
- **Framework**: WXT (framework-agnostic Chrome extension framework with Svelte support)
- **UI**: Svelte 5 + CSS (no Tailwind to keep it lightweight)
- **Build**: Vite (via WXT)
- **Manifest**: V3
- **APIs**: TMDb API, Google Custom Search / scraping

## Architecture

```
entrypoints/
├── background/
│   └── index.ts              # Service worker: manages API calls, caching, message routing
├── popup/
│   ├── index.html            # Popup shell
│   ├── main.ts               # Popup entry
│   ├── App.svelte            # Main popup UI
│   └── components/
│       ├── Settings.svelte    # TMDb API key input, username config
│       ├── RecommendationList.svelte  # List of recommended movies
│       └── MovieCard.svelte   # Individual movie card
├── content/
│   └── index.ts              # Content script: scrapes Letterboxd pages + injects overlay
└── overlay/
    ├── index.html            # Injected recommendations panel on Letterboxd
    └── App.svelte            # Overlay Svelte app

lib/
├── scraper.ts                # Letterboxd DOM scraping logic
├── tmdb.ts                   # TMDb API client (similar/recommendations endpoints)
├── search.ts                 # Google search + Reddit r/IfYouLikeBlank scraping
├── recommender.ts            # Combines all recommendation sources, deduplicates, ranks
├── storage.ts                # Chrome storage wrapper for settings + cached data
└── types.ts                  # Shared TypeScript types
```

## Step-by-Step Implementation

### Step 1: Project Scaffolding
- Initialize WXT project with Svelte template: `pnpm dlx wxt@latest init`
- Configure `wxt.config.ts` for Svelte
- Set up TypeScript, basic project structure
- Create `manifest.json` overrides (permissions: `activeTab`, `storage`, `tabs`; host permissions for `*://*.letterboxd.com/*`, `*://api.themoviedb.org/*`)

### Step 2: Shared Types & Storage (`lib/`)
- Define types: `Film`, `Rating`, `Recommendation`, `UserSettings`
- Build Chrome storage wrapper for persisting:
  - TMDb API key
  - Letterboxd username
  - Cached scraped films
  - Cached recommendations

### Step 3: Letterboxd Scraper (`lib/scraper.ts` + content script)
- Content script runs on `*://*.letterboxd.com/*` pages
- Scraping targets:
  - **Rated films**: `/username/films/ratings/` — extract film slug, title, user rating from the DOM
  - **Liked films**: `/username/likes/films/` — extract liked film slugs/titles
  - **Reviews**: `/username/films/reviews/` — extract review text + rating
  - **Watched films**: `/username/films/` — the full list of films they've watched, to exclude from recommendations
  - **Watchlist**: `/username/watchlist/` — to flag (not exclude) films already on watchlist
- Handle pagination (Letterboxd shows ~72 films per page, paginated via `/page/N/`)
- Extract data attributes from poster containers (`data-film-slug`, `data-film-id`, etc.)
- Send scraped data to background via `chrome.runtime.sendMessage`

### Step 4: TMDb API Client (`lib/tmdb.ts`)
- User provides their own TMDb API key (free to register)
- Endpoints to use:
  - **Search**: `/search/movie` — resolve Letterboxd film slugs to TMDb IDs
  - **Recommendations**: `/movie/{id}/recommendations` — user-behavior-based recs
  - **Similar**: `/movie/{id}/similar` — genre/keyword-based recs
  - **Details**: `/movie/{id}` — poster, overview, rating, genres
- Use `append_to_response` to batch recommendations+similar in one call
- Respect rate limit: 40 requests per 10 seconds
- Cache results in Chrome storage

### Step 5: Search-Based Recommendations (`lib/search.ts`)
- For the user's top-rated/liked films, search for:
  - `site:reddit.com/r/ifyoulikeblank "movie title"` via fetch
  - `"if I like [movie title]" movies recommendations`
- Parse search result snippets/titles for movie name mentions
- Optionally fetch Reddit thread pages and extract movie titles from comments
- This is a supplementary signal — lower confidence than TMDb results

### Step 6: Recommendation Engine (`lib/recommender.ts`)
- Input: user's rated films (with ratings), liked films, watchlist
- Process:
  1. Take top N highest-rated + all liked films as "seed" films
  2. Fetch TMDb recommendations + similar for each seed
  3. Fetch search-based recommendations for top seeds
  4. Score each recommended film:
     - Frequency: how many seed films recommended it
     - Source weight: TMDb recommendations > TMDb similar > search-based
     - Already seen: exclude ALL films from the user's watched list (rated, reviewed, liked, or simply logged)
     - Watchlist: flag (but don't exclude) films already on watchlist
  5. Deduplicate by TMDb ID
  6. Return sorted list with scores and "because you liked X" reasoning

### Step 7: Popup UI (`entrypoints/popup/`)
- **Settings tab**: TMDb API key input, Letterboxd username, "Scan Profile" button
- **Recommendations tab**: Scrollable list of movie cards showing:
  - Poster image (from TMDb)
  - Title + year
  - TMDb rating
  - "Because you liked: Film A, Film B" reasoning
  - Link to Letterboxd page + TMDb page
- Loading states, error handling
- Compact design (popup is ~400x600px max)

### Step 8: Letterboxd Overlay (content script injection)
- When user is on a Letterboxd film page, inject a small "Recommendations" section
- Shows 3-5 similar films based on that specific film + user's taste profile
- Styled to match Letterboxd's dark theme
- Collapsible/dismissable
- Inject via shadow DOM to avoid CSS conflicts

### Step 9: Background Service Worker
- Message router: handles messages from content script and popup
- Orchestrates scraping → API calls → recommendation generation
- Manages caching and periodic refresh
- Handles TMDb API rate limiting with a request queue

### Step 10: Polish & Edge Cases
- Handle private Letterboxd profiles (show error message)
- Handle missing TMDb matches (some obscure films won't match)
- Loading/progress indicators during profile scanning
- "Refresh recommendations" action
- Extension icon badge showing recommendation count

## Key Design Decisions

1. **User provides TMDb API key**: Avoids us needing a backend server. TMDb keys are free.
2. **Content script scraping**: Since the user is browsing Letterboxd, we have full DOM access — no need for a separate scraper server or headless browser.
3. **Shadow DOM for overlay**: Prevents Letterboxd's CSS from affecting our injected UI and vice versa.
4. **WXT framework**: Best-in-class DX for Chrome extensions with Svelte — handles HMR, manifest generation, and multi-entrypoint bundling.
5. **Hybrid recommendation sources**: TMDb for structured data, Reddit/Google for serendipitous discovery.

---


## Documentation Guardrails

1. `PLAN.md` is for planned/future changes only.
2. `CHANGELOG.md` is for shipped releases only.
3. Historical planning context belongs in this README appendix.
4. On each version bump, update `CHANGELOG.md` first, then bump version fields.
