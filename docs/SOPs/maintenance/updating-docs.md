# Updating documentation — storygroove-be

## When to update

- New or changed routes → `docs/api/endpoints/*.md` and `architecture/application-architecture.md` if mounts change.
- Mongoose schema → `docs/database/schema/*.md` and `migration-history.md` for notable changes.
- Security or subscription logic → `architecture/security-architecture.md`, `.cursor/rules/500-security.mdc`, `docs/api/contracts/api-overview.md`.
- Feature inventory → `docs/features/<slug>.md` + `.paths.json` per `AGENTS.md`.
- Writer-visible flow (checkout, verify, coaches, billing) → `docs/user-guide/` **and** the matching chapter in `storygroove-fe/docs/user-guide/`. Quote API behaviour here; quote button labels there.

## How

1. Edit markdown in the same PR as the code when feasible.
2. Keep tables scannable; link to code paths instead of pasting large payloads.
3. Refresh `.cursor/context-priority.md` if you introduce a new major doc area.

## Review

Docs PRs should be reviewed for accuracy against `routers/*.js` source of truth.
