# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [Unreleased]

### Added
- None yet.

### Changed
- None yet.

### Fixed
- None yet.

### Security
- None yet.

## [1.0.4] - 2026-02-24

### Fixed
- Eliminate "Get Started" page flash on popup reopen by preloading cached state directly from local storage.

## [1.0.3] - 2026-02-21

### Added
- Canonical recommendation URL normalization utility with bounded concurrency to resolve Letterboxd canonical slugs before popup render.
- Popup onboarding now includes a pinning step for first-run guidance.

### Changed
- Recommendation responses are canonicalized in the service worker for cached and fresh generation paths.
- Popup recommendation links now use stored canonical URLs directly without stripping year suffixes.

### Fixed
- Letterboxd slug generation now strips apostrophes instead of converting them to hyphens (e.g., `Miller's Crossing` -> `millers-crossing`).
- Year-disambiguated Letterboxd slugs (e.g., `the-lighthouse-2019`) are preserved and surfaced in popup links.

### Security
- None.

## [1.0.2] - 2026-02-20

_Backfilled from commit history; early releases were not formally changelogged._

### Added
- Build guardrail workflow (`doctor` checks, single-flight build lock, rebuild commands).
- Phase 1 TMDb proxy hardening plan in planning docs.

### Changed
- In-page recommendation UI was polished/cleaned.
- Packaging and release flow aligned around `Lekkerboxd-store.zip` and `Lekkerboxd-github.zip`.

### Fixed
- Local build reliability issues caused by duplicated workspace artifacts and inconsistent build state.

### Security
- Project planning now includes explicit proxy hardening controls and operational response steps.

## [1.0.1] - 2026-02-19

_Backfilled from commit history; early releases were not formally changelogged._

### Added
- Initial public extension baseline.
- Dual distribution model documentation (Store proxy-default vs GitHub direct-key).

### Changed
- Install/setup documentation clarified by channel.
- Legacy release artifact cleanup (`Lekkerboxd.zip` removed in favor of channel-specific artifacts).

### Fixed
- Documentation consistency updates across setup and distribution guidance.

### Security
- Distribution split established to reduce proxy abuse exposure for non-store installs.

---

## GitHub Release Template

Use this for GitHub Releases:

1. `## vX.Y.Z - <short title>`
2. `### Downloads`
3. `### Added`
4. `### Changed`
5. `### Fixed`
6. `### Security`
7. `### Verification`

Include download artifact names explicitly:

- `Lekkerboxd-store.zip`
- `Lekkerboxd-github.zip`
