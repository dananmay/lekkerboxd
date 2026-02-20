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
