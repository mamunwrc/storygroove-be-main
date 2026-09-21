# Infrastructure — storygroove-be

## Runtime

- **Node.js** (LTS recommended). Start with **`node index.js`** or npm scripts from `package.json` (e.g. dev server with nodemon if defined).
- Default **HTTP port** **8086** via `PORT` environment variable.

## Database

- **MongoDB** connection string **`MONGO_URI`** and database name **`MONGODB_NAME`** (see `config/db.js`). Process exits on failed connect in current implementation.

## Object storage

- **AWS S3**: `AWS_S3_BUCKET_NAME` and credentials expected by `@aws-sdk/client-s3` default provider chain (`config/s3Client.js`).
- **GET `/userData/*`** proxies object bytes to clients with cache headers (`index.js`).

## Background / static assets

- Local directory **`backgrounds/`** served at **`/backgrounds`** for image extensions only.

## External APIs

- **OpenAI**: API keys via env and/or `User.openaiKey` depending on route; Responses API is the primary integration.
- **Stripe**: secret key, publishable key (mostly for frontend), webhook signing secret — all via env (`stripeController`, `stripeService`).

## Environment variables (representative)

Set in deployment or `.env` (never commit secrets). Typical names include:

- `MONGO_URI`, `MONGODB_NAME`
- `JWT_SECRET`, `JWT_LIFETIME`
- `CLIENT_URL`, optional `HOST_LINK`, `SERVER_URL`, `DASHBOARD_URL` (billing redirects)
- `PORT`
- Stripe: `STRIPE_SECRET_KEY`, webhook secret, price id variables (`PRICE_BUILDER_*`, `PRICE_STUDIO_*`, `SIMONE_ONETIME_PRICE`, …)
- AWS: `AWS_S3_BUCKET_NAME`, region/credentials per AWS SDK conventions
- OpenAI / feature flags as referenced in services (e.g. `OLIVIA_MEMORY_V2_ENABLED`)

## Containers and CI

Not applicable — this repository does not define a canonical Docker or Kubernetes deployment manifest in-tree. Document deployment glue in your platform repo or internal runbooks.

## Local development

See `README.md` and `docs/SOPs/development/onboarding.md` for Docker Compose Mongo and first-run seeding hints.
