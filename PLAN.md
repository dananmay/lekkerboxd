# Letterboxd Recommendations Chrome Extension — Implementation Plan

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
