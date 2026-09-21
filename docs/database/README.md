# Database documentation — storygroove-be

MongoDB is accessed through **Mongoose** models in `models/`. This folder captures **human-readable** inventory and policies; the code remains the source of truth for exact field types and defaults.

## Contents

| Path | Purpose |
|------|---------|
| [schema/current-schema.md](schema/current-schema.md) | Collection-by-collection summary |
| [schema/tables-overview.md](schema/tables-overview.md) | Quick index of models |
| [schema/data-dictionary.md](schema/data-dictionary.md) | Important fields and relationships |
| [migrations/migration-policy.md](migrations/migration-policy.md) | How schema changes are rolled out |
| [migrations/migration-history.md](migration-history.md) | Chronological manual log |
| [rules/naming-conventions.md](rules/naming-conventions.md) | Naming guidance |
| [rules/indexing-strategy.md](rules/indexing-strategy.md) | When to add indexes |
| [rules/constraints-policy.md](rules/constraints-policy.md) | Unique, soft delete, refs |
| [rules/data-types-standards.md](rules/data-types-standards.md) | Mongoose type usage |

## Updating

When you add or change a model, update the **schema** docs in the same PR when the change is user-visible or affects API contracts.
