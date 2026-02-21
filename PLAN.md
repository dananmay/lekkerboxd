# Project Plan

This file tracks planned/future changes only.

Historical implementation planning is archived in `README.md` (Appendix: Legacy Implementation Plan (Historical)).  
For shipped changes, see `CHANGELOG.md`.

## Phase 1 Proxy Hardening Plan (No Backend Auth, Low Complexity)

### Summary
Harden the TMDb proxy against easy abuse without changing product UX or adding backend auth.
This phase focuses on strict request validation, explicit fail-closed behavior, Cloudflare edge
rate limits, stronger cache defaults, and monitoring/kill-switch operations.

### Goals
1. Reduce proxy abuse blast radius if origin/header checks are spoofed.
2. Keep Store build UX unchanged.
3. Avoid architecture changes (no token issuer/backend in this phase).
4. Keep false-positive blocking low for normal recommendation usage.

### In Scope
1. Worker-side validation tightening in `cloudflare/tmdb-proxy/src/index.ts`.
2. Cloudflare dashboard rate-limiting rules on the Worker route.
3. Proxy config defaults and operational controls (`wrangler` secrets/vars and alerting).
4. Verification checklist with explicit curl and extension smoke tests.

### Out of Scope
1. Signed short-lived tokens from a backend.
2. Per-user authentication.
3. Major extension-side architecture changes.

### 1) Worker hardening changes

#### 1.1 Keep strict allowlist + fail closed
1. Keep `ALLOWED_ORIGIN` mandatory.
2. Keep 500 on missing `ALLOWED_ORIGIN` (misconfiguration).
3. Keep 403 on missing/invalid client origin.
4. Keep CORS allow-origin only for matched allowed origins (never wildcard reflect).

#### 1.2 Tighten path and parameter rules (explicit reject, not silent ignore)
1. Allowed paths remain only:
   - `/search/movie`
   - `/movie/{id}`
2. Reject unknown query params with `400`.
3. `/search/movie` must include:
   - `query` required, trimmed length `1..120`.
4. `/search/movie` allowed params and bounds:
   - `query` string length `1..120`
   - `year` integer `1888..(currentYear+1)`
   - `language` regex `^[a-z]{2}(-[A-Z]{2})?$`
   - `page` integer `1..3`
   - `include_adult` only `false` (or absent)
5. `/movie/{id}` allowed params:
   - `language` regex `^[a-z]{2}(-[A-Z]{2})?$`
   - `append_to_response` only exact `recommendations,similar` (or absent)
   - `page/query/year/include_adult` forbidden on this route
6. Reject invalid values with `400` and stable JSON error messages.
7. Keep `GET`-only and `OPTIONS` preflight behavior.

#### 1.3 Cache key normalization
1. Normalize `query` before cache key creation:
   - trim
   - collapse internal whitespace
   - lowercase
2. Keep cache separated by `language`, `year`, `page`, and route.
3. Keep in-flight dedupe map as-is.

#### 1.4 Cache TTL defaults (more defensive against cost spikes)
1. Set default search TTL to `900` seconds (from 600).
2. Set default movie TTL to `43200` seconds (from 21600).
3. Keep env overrides:
   - `CACHE_TTL_SEARCH_SECONDS`
   - `CACHE_TTL_MOVIE_SECONDS`

#### 1.5 Optional kill switch (small addition)
1. Add env flag `PROXY_ENABLED` (default `true`).
2. If `false`, return `503` with `{ "error": "Proxy temporarily disabled" }`.
3. This provides emergency stop during abuse spikes.

### 2) Cloudflare edge controls (exact thresholds)

Apply these rules in Cloudflare Rate Limiting for the Worker domain:

1. Rule A (search endpoint)
   - Match path: `/v1/tmdb/search/movie`
   - Threshold: `150 requests / 60s / IP`
   - Action: block
   - Mitigation timeout: `120s`

2. Rule B (movie endpoint)
   - Match path regex: `^/v1/tmdb/movie/\d+$`
   - Threshold: `180 requests / 60s / IP`
   - Action: block
   - Mitigation timeout: `120s`

3. Rule C (global endpoint guard)
   - Match path prefix: `/v1/tmdb/`
   - Threshold: `300 requests / 60s / IP`
   - Action: block
   - Mitigation timeout: `300s`

4. Rule D (slow-burn abuse guard)
   - Match path prefix: `/v1/tmdb/`
   - Threshold: `2000 requests / 10m / IP`
   - Action: block
   - Mitigation timeout: `3600s`

These limits are intentionally above normal single-user generation bursts but low enough to cut
scripted relay abuse.

### 3) Extension compatibility checks (no behavior change expected)
1. Store build should continue proxy default behavior unchanged.
2. GitHub build remains direct-only.
3. Keep current `X-Lekkerboxd-Origin` header from extension.
4. No manifest permission changes required for this phase.

### 4) Operational monitoring and response
1. Enable alert: request volume > `25,000/hour` on Worker.
2. Enable alert: 403 ratio > `60%` for `15m` (probing indicator).
3. Enable alert: 5xx ratio > `2%` for `10m`.
4. Incident playbook:
   - Step 1: set `PROXY_ENABLED=false` and deploy if active abuse.
   - Step 2: tighten Rule A/B thresholds by 20%.
   - Step 3: rotate `TMDB_API_KEY` only if compromise is suspected.
   - Step 4: review top client IPs and add temporary IP blocks if needed.

### 5) Files and interface changes

#### Code files
1. `cloudflare/tmdb-proxy/src/index.ts`
2. `cloudflare/tmdb-proxy/README.md` (document new validation and kill switch)

#### Env/config interface changes
1. New optional env var: `PROXY_ENABLED` (`true|false`, default true)
2. Existing vars retained:
   - `ALLOWED_ORIGIN` (required)
   - `TMDB_API_KEY` (required)
   - `CACHE_TTL_SEARCH_SECONDS`
   - `CACHE_TTL_MOVIE_SECONDS`

No extension message/type API changes.

### 6) Test cases and verification scenarios
1. Allowed origin request to `/search/movie?query=inception` returns 200.
2. Disallowed origin returns 403.
3. Missing origin/referer/header returns 403.
4. Unknown path returns 403/404 as designed.
5. Invalid param key (for example `foo=bar`) returns 400.
6. Invalid `query` length (0 or >120) returns 400.
7. Invalid `year` (`1700`, non-numeric) returns 400.
8. Invalid `page` (`0`, `4`) returns 400.
9. Invalid `append_to_response` value returns 400.
10. Cache behavior:
   - repeated same request returns `X-Cache: HIT`.
11. Rate-limit behavior:
   - scripted burst above threshold gets blocked.
12. Extension smoke:
   - Store build generates recommendations normally.
   - Background generation still continues while popup is closed.
   - GitHub build behavior unchanged (direct key required).

### 7) Rollout sequence
1. Implement worker validation + kill switch.
2. Deploy to Worker.
3. Configure Rule A/B/C/D in Cloudflare.
4. Run curl validation matrix.
5. Run Store extension smoke test end-to-end.
6. Monitor for 24 hours.
7. Tune thresholds only if false positives appear.

### Assumptions and defaults
1. Target is low-friction hardening now; full auth proxy is deferred.
2. Current traffic profile is approximately low-to-moderate consumer extension traffic.
3. Slightly stricter validation is acceptable if it reduces abuse risk.
4. Default thresholds above are the initial baseline and may be tuned after first-day telemetry.

## Phase 2 Popup Open Latency Reduction Plan (UI-First, <500ms Target)

### Summary
Reduce extension click-to-open delay in both dropdown and pop-out modes by prioritizing instant UI paint, reducing popup startup round-trips, and removing background contention from automatic film-page recommendation generation.

### Goals
1. Keep popup open perception fast and stable in both launch modes.
2. Target hydrated startup under `500ms` on a typical machine.
3. Preserve existing recommendation quality, scoring, and background-generation behavior.
4. Avoid broad architecture changes or backend dependencies.

### In Scope
1. Popup startup message consolidation and two-phase hydration.
2. Launch-mode routing optimization for pop-out.
3. Deferring film-page overlay generation until user-triggered.
4. Lightweight popup rendering optimizations.
5. Startup latency instrumentation and regression validation.

### Out of Scope
1. Scoring model changes.
2. Recommendation-source fanout changes for main popup generation.
3. TMDb proxy architecture changes.
4. New permissions or host-permission expansions.

### 1) Popup startup optimization

#### 1.1 Add unified bootstrap message
1. Add `GET_POPUP_BOOTSTRAP` message in `src/types/messages.ts`.
2. Implement handler in `src/background/service-worker.ts`.
3. Return a single payload containing:
   - settings
   - profile
   - cached recommendations
   - generating flag/status
   - pending generation marker
   - service health

#### 1.2 Two-phase popup hydration
1. In `src/popup/Popup.svelte`, render shell immediately from a direct `chrome.storage.local.get([...])`.
2. After first paint, call `GET_POPUP_BOOTSTRAP` and reconcile state.
3. Keep pending-generation resume logic, but execute after initial paint.

#### 1.3 Fallback behavior
1. If bootstrap call fails, retain storage-derived UI and surface non-blocking warning.
2. Do not block opening on background worker wake-up.

### 2) Launch-mode open-path optimization

#### 2.1 Route by action mode in background
1. In `src/background/service-worker.ts`, apply launch behavior using `chrome.action`:
   - `popup` mode: `chrome.action.setPopup({ popup: 'src/popup/index.html' })`
   - `window` mode: `chrome.action.setPopup({ popup: '' })` and open/focus via `chrome.action.onClicked`

#### 2.2 Keep explicit window open path
1. Retain existing `OPEN_APP_WINDOW` for settings button/manual open.
2. Remove popup self-redirect dependency at startup in `src/popup/Popup.svelte`.

#### 2.3 Sync on settings updates
1. Re-apply action routing immediately when `launchMode` changes via `SAVE_SETTINGS`.

### 3) Reduce background contention from film-page overlay

#### 3.1 Defer film-page generation until requested
1. In `src/content/main.ts`, remove automatic `GET_FILM_RECOMMENDATIONS` call on film page load.
2. Add user-triggered action in overlay container to request recommendations on demand.
3. Cache result per tab/page instance to avoid repeated calls in the same session.

#### 3.2 Preserve feature behavior
1. Keep current overlay rendering logic once results arrive.
2. Keep single-seed engine path unchanged.

### 4) Popup render-cost reductions

#### 4.1 Recommendation list rendering
1. Apply `content-visibility: auto` to recommendation cards/list container in `src/popup/Popup.svelte`.
2. Add `contain-intrinsic-size` to reduce layout work before full paint.
3. Keep `loading="lazy"` posters and current visual behavior.

#### 4.2 No behavioral changes
1. Keep recommendation ordering, scores, and actions unchanged.

### 5) Startup instrumentation and acceptance criteria

#### 5.1 Add timing metrics (debug only)
1. `popup_mount_to_shell_paint_ms`
2. `popup_bootstrap_roundtrip_ms`
3. `popup_hydrated_total_ms`

#### 5.2 Acceptance thresholds
1. Popup shell visibly opens quickly in both modes with no spinner-gating.
2. Hydrated state is typically under `500ms`.
3. No regression in "generation continues while popup is closed".

### 6) Verification plan

#### 6.1 Automated
1. `npm run build:store`
2. `npm run build:github`
3. `npm run ci:check:store`
4. `npm run ci:check:github`

#### 6.2 Manual smoke
1. Dropdown mode cold/warm open latency check.
2. Pop-out mode click opens/focuses without redirect lag.
3. Reopen during active generation attaches to in-flight job.
4. Film pages no longer auto-trigger generation on load.
5. On-demand film-page recommendations still render correctly.
6. Watchlist, JustWatch, and Letterboxd open actions remain intact.

## Phase 3 List-Based Seed Recommendations Plan (Up to 30 Films)

### Summary
Add a new recommendation mode where users can provide a public Letterboxd list URL and get suggestions from up to 30 films in that list, instead of using profile-selected seeds.
List mode overrides profile-seed mode when a list URL is set.
List films are weighted equally.
If a scanned profile exists, watched-film exclusion still applies.

### Goals
1. Support recommendations from a user-provided Letterboxd list (`<=30` films).
2. Keep existing profile-seed flow unchanged when no list URL is configured.
3. Ensure deterministic popup links/behavior remain unchanged.
4. Avoid expanding runtime message surface with new message types.

### In Scope
1. Settings support for storing a list URL.
2. Service worker list fetch/parsing and seed preparation.
3. Engine path for explicit seed arrays.
4. Cache separation between profile mode and list mode.
5. Popup/settings UX updates for list mode visibility and errors.
6. Test coverage for URL parsing, list fetch behavior, and mode switching.

### Out of Scope
1. Private/authenticated list access support.
2. New permissions or manifest changes.
3. New background message types for list resolution.
4. List-order priority weighting.

### 1) Settings and interface updates

#### 1.1 Settings schema
1. Add `seedListUrl: string` to `Settings` in `src/lib/storage/settings-store.ts`.
2. Default `seedListUrl` to empty string.
3. Persist through existing `saveSettings(...)`.

#### 1.2 Message typing
1. Add optional `seedListUrl?: string` to `SaveSettingsMessage.settings` in `src/types/messages.ts`.
2. Do not add any new message types.

#### 1.3 Settings UI placement
1. Add a visible list URL input in the normal settings panel in `src/popup/Settings.svelte` (not hidden under Advanced).
2. Copy text: list mode uses first 30 films; clearing URL returns to profile mode.

### 2) Letterboxd list URL parsing and fetch flow

#### 2.1 Utility
1. Add `src/lib/utils/letterboxd-list.ts`.
2. Implement URL validation/canonicalization for public list pattern: `https://letterboxd.com/{user}/list/{slug}/`.
3. Implement page URL builder for paginated list fetches.

#### 2.2 Service worker list fetch
1. In `src/background/service-worker.ts`, add helper to fetch list pages and parse films with existing `parseFilmsFromHTML(...)` and `parsePaginationFromHTML(...)`.
2. Deduplicate by `slug`.
3. Stop at 30 films maximum.
4. Enforce minimum viable seeds (recommended: at least 3) with clear error if not met.

### 3) Recommendation generation integration

#### 3.1 Explicit-seed engine entrypoint
1. Add exported explicit-seed wrapper in `src/lib/engine/recommendation-engine.ts`.
2. Reuse existing internal seed pipeline; no scoring model fork.

#### 3.2 Mode routing in generation
1. In `executeGeneration(...)` in `src/background/service-worker.ts`:
   1. If `seedListUrl` exists and is valid, run list mode.
   2. Otherwise run existing profile-seed mode.
2. In list mode, include watched/watchlist exclusion from scanned profile if available.
3. Do not require liked/rated profile data for list mode.

#### 3.3 Canonical URL pass
1. Keep current canonical slug resolution pass for generated recommendations unchanged.

### 4) Cache key separation for modes

#### 4.1 Cache scope
1. Extend cache helpers in `src/lib/storage/cache-store.ts` to support scope-aware keys (profile vs list).
2. Use distinct list scope based on canonical list identity so list results do not overwrite profile results.

#### 4.2 Fingerprint alignment
1. Include mode-specific inputs in fingerprint/build validity checks in `src/background/service-worker.ts`.
2. Preserve existing profile fingerprint behavior for profile mode.

### 5) Popup behavior and UX text

#### 5.1 Popup load/generate flow
1. Keep existing `GET_RECOMMENDATIONS` message contract in `src/popup/Popup.svelte`.
2. Update loading/status copy so it does not imply profile-only seeds while list mode is active.

#### 5.2 Error handling
1. Show actionable errors for invalid URL, inaccessible list, and insufficient films.
2. Keep existing error bar rendering behavior.

### 6) Tests and verification

#### 6.1 Automated tests
1. Extend `tests/run-tests.ts` with:
   1. list URL parse/canonicalization tests,
   2. list pagination URL builder tests,
   3. seed cap/dedup tests,
   4. mode-switch/cache-scope behavior tests (unit-level where practical).

#### 6.2 Build checks
1. `npx tsx tests/run-tests.ts`
2. `npm run build:store`
3. `npm run build:github`

#### 6.3 Manual checks
1. Empty `seedListUrl` uses existing profile mode.
2. Valid list URL uses list mode and reports list-derived seed count.
3. Clearing list URL restores profile-mode cached behavior.
4. Watched exclusions still apply when profile exists.
5. Links/open/watchlist actions behave unchanged.

### 7) Rollout sequence
1. Land settings schema + UI input.
2. Land list URL utility + service worker fetch/parser integration.
3. Land explicit-seed engine wrapper + generation routing.
4. Land cache-scope updates.
5. Add tests and run build/test matrix.
6. Smoke test both store and GitHub distributions.

### Assumptions and defaults
1. Only public Letterboxd list URLs are supported.
2. List mode overrides profile mode whenever list URL is non-empty and valid.
3. List films are equally weighted.
4. No new permissions, manifest changes, or runtime message types are required.
