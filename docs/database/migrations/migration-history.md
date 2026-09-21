# Migration history — storygroove-be

Schema evolution is continuous via **Mongoose** files; this log records **notable** or **data-moving** changes. Add a row when you ship something operators must know about.

| Date | Change | Notes |
|------|--------|-------|
| 2026-08-19 | Character multi-lead indexes | Dropped single-slot unique `{ novel, character }` for protagonist/antagonist. Uniqueness is now `{ novel, name, character }` for all cast types. **Ops (not a data backfill):** drop the old index in MongoDB before relying on multi-lead inserts, e.g. `db.characters.dropIndex("novel_1_character_1")` (confirm the exact name with `db.characters.getIndexes()`). Existing Character documents are unchanged. |
| 2026-05-26 | Documentation baseline | Initial `docs/database` sync from current `models/*.js`. No DB mutation. |

Earlier history: not tracked in this file — infer from git history of `models/` when needed.
