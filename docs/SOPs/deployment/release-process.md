# Release process — storygroove-be

## Pre-release

1. Merge approved PRs to the release branch.
2. Confirm `.env` template or deployment manifest lists any **new** environment variables.
3. Run automated tests available in `package.json`.
4. For schema changes, ensure `docs/database/migrations/migration-history.md` is updated and backfill scripts are scheduled if needed.

## Deploy

1. Build or copy Node artifacts per hosting (plain `node index.js`, PM2, container, etc.).
2. Apply infrastructure changes (Mongo indexes, Stripe webhook URL, S3 policies) in the correct order. For Character multi-lead support, drop the legacy unique index on `{ novel, character }` for protagonist/antagonist (see [migration-history.md](../../database/migrations/migration-history.md)); Mongoose will not remove it automatically.
3. Roll the API instances; verify **`GET /`** and a smoke authenticated call.

## Post-release

- Monitor error rates, Stripe dashboard, and OpenAI usage dashboards.
- Announce breaking API changes to frontend owners.

Not applicable: this repository does not ship a single canonical CI/CD pipeline file for all environments—adapt steps to your platform.
