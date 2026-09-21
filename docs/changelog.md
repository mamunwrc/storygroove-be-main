# Changelog — storygroove-be

All paths are relative to this repository root.

## 2026-09-01

- Proposed **staged AI / cost architecture**: `architecture/staged-ai-architecture.md` and ADR `architecture/ADRs/0003-staged-story-runtime.md` (artifacts over full-history replay; LangGraph deferred).

## 2026-08-21

- Added **operator user guide** at `docs/user-guide/` covering checkout provisioning, account activation, entitlements, Simone/Olivia/Ellis, subscription lifecycle, and stuck-user diagnosis. Writer-facing counterpart: `storygroove-fe/docs/user-guide/`.
- Corrected `docs/api/endpoints/stripe-subscription-endpoints.md`: pause/resume, public checkout, admin invite; `get-price-list` requires JWT.

## 2026-05-26

- Initial **backend documentation bundle** under `docs/`, `architecture/`, and `.cursor/` aligned with current `routers/`, `models/`, and `index.js` (S3 `userData` proxy, Stripe webhook ordering, admin mounts).
- Added **Olivia bounded context** detailed spec at `docs/features/olivia-bounded-context/specification.md`.
