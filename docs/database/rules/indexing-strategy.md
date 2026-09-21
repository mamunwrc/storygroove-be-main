# Indexing strategy — storygroove-be

Add indexes when **query patterns** repeat at scale or enforce uniqueness.

## When to index

- Filtering or sorting on a field in hot paths (e.g. `Thread` lookups by `threadId` + `userId`).
- Compound uniqueness (novel + scene slice uniqueness for review artifacts).
- Soft-delete patterns (`Novel` uses `{ user: 1, deletedAt: 1 }`).

## How to define

Use `Schema.index({ ... }, { unique: true })` or partial indexes if MongoDB version supports your rule set. Keep index names meaningful when multiple indexes exist on one collection.

## Caveats

- Index builds on large collections can impact performance—schedule consciously.
- Remove obsolete indexes only after verifying production query plans no longer depend on them.

## Documentation

When adding an index for a new feature, mention the **query** or **controller** that motivated it in the PR description and optionally append to `migration-history.md` if operators must monitor build time.
