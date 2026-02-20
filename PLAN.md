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
