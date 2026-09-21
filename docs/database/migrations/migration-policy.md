# Migration policy — storygroove-be

## Approach

There is **no automated migration runner** (no Prisma, no `migrate-mongo` wrapper in-tree). **Schema changes ship with application code** through updated Mongoose schemas in `models/`.

## Author workflow

1. Edit the relevant `models/*.js` file (fields, indexes, hooks).
2. Deploy the API with the new code.
3. If the change requires **data backfill** (new required field, renamed meaning, denormalized cache), add a **one-off script** under `scripts/` or a documented manual procedure and link it from `migration-history.md`.
4. For large collections, plan index builds during a maintenance window (MongoDB builds indexes online but they still consume resources).

## Rollback

Rollback is **redeploy previous image/commit**. Because there is no versioned migration table, coordinate with ops if a rollback must happen after irreversible data writes.

## Testing

- Run unit tests under `__tests__/` when schema logic affects business rules.
- Validate optional fields default safely for existing documents (Mongoose applies defaults on read only when defined on schema — understand `undefined` vs `null`).
