# Final Publish Checklist (Lekkerboxd v1.0.1)

## A) Verified Build State
- [x] Version is `1.0.1` in `package.json` and `manifest.json`.
- [x] `npm run ci:check` passed (privacy check + build + tests).
- [x] Latest build output is in `dist/`.
- [x] `Lekkerboxd.zip` was repacked from current `dist/`.
- [x] Zip sanity check: `manifest.json` is at archive root.

## B) Proxy + Security (Must verify in Cloudflare before publish)
- [x] Worker deployed with latest `cloudflare/tmdb-proxy/src/index.ts`.
- [x] Worker enforces strict origin allowlist with extension compatibility fallback:
  - `ALLOWED_ORIGIN` required.
  - `X-Lekkerboxd-Origin` header path enabled for extension contexts without `Origin`/`Referer`.
- [x] Secrets present:
  - `TMDB_API_KEY`
  - `ALLOWED_ORIGIN` = `chrome-extension://<published-extension-id>`
- [x] If using multiple extension IDs (dev/prod), `ALLOWED_ORIGIN` is comma-separated exact origins. (Current publish setup uses a single ID.)
- [x] Proxy mode tested successfully after deploy.

## C) Required Manual E2E Smoke Test
Use a clean browser profile if possible.

- [x] Install unpacked extension from latest `dist/`.
- [x] Open Letterboxd while logged in; confirm username auto-detected.
- [x] Run `Scan Profile`.
- [x] Click `Get Recommendations`.
- [x] Close popup during generation, wait, reopen.
- [x] Confirm generation continues while closed and results appear on reopen.
- [x] Verify recommendation card actions:
  - Open Letterboxd film page works.
  - `+` Add to watchlist works (or documented fallback opens film page).
  - Eye button opens JustWatch.
- [x] Verify Advanced settings:
  - Launch mode toggle works (`Dropdown` / `Pop-out`).
  - JustWatch region supports full country list with `Auto` default.
  - Optional direct TMDb key path still works.
- [x] Verify degraded fallback behavior:
  - Degraded banner appears when Letterboxd parser/watchlist API fails.
  - Cached data path still works.
- [ ] Re-run close/reopen background-generation smoke check after latest scoring tuning changes.
- [ ] Verify recommendation list scores are non-increasing from top to bottom (no lower score above higher score).
- [ ] Spot-check 10 recommendations for obvious title/year mismatches from external sources (Reddit/Taste.io), especially common-name films.

## D) Docs + Listing Readiness
- [x] `README.md` reflects current architecture and troubleshooting.
- [x] Privacy policy reflects current behavior (`src/privacy/PrivacyPolicy.svelte`).
- [x] How-it-works page reflects current behavior (`src/scoring/ScoringDoc.svelte`).
- [ ] Store listing text/screenshots updated to match v1.0.1.
- [ ] Support contact / issue-reporting link confirmed.

## E) Final Pre-Publish Gate
- [x] After any last edits, rerun `npm run ci:check`.
- [x] If anything changed after that run, repack `Lekkerboxd.zip` again.

## Notes
- Privacy checker currently prints a non-blocking warning for explicit Worker host matching in its internal list; check still passes.
