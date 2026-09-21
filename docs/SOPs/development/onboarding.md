# Onboarding — storygroove-be

## Prerequisites

- **Node.js** LTS installed (`node -v`).
- **npm** (`npm -v`).
- **MongoDB** reachable from your machine.

## Checkout and install

```bash
cd storygroove-be
npm install
```

## Environment variables

Copy production-like values into `.env` for local integration testing. Typical keys include **`MONGO_URI`**, **`MONGODB_NAME`**, **`JWT_SECRET`**, **`CLIENT_URL`**, Stripe keys and price identifiers, AWS S3 bucket name, and OpenAI-related configuration. Never commit `.env`.

See root **`README.md`** for a minimal local example using Docker Compose for Mongo.

### Local dev without S3 (Cover Studio only)

If you do not have valid AWS credentials locally, enable disk storage for generated cover images:

```env
LOCAL_FILE_STORAGE=true
# optional: LOCAL_FILE_STORAGE_DIR=./local-userData
```

Restart the API after changing `.env`. Cover renders are written under `storygroove-be/local-userData/userData/{userId}/covers/` and served via the existing `GET /userData/*` route.

Profile pictures and chat file attachments still use S3 via Multer (`config/multer.js`) and require real AWS credentials or a follow-up local-storage extension.

### Cover Studio title override (local dev)

When testing cover title corrections in chat, the working concept may store `displayTitle` separately from `novel.name`. Re-sync cover prompts after editing repo txt files: `node scripts/syncCoverAgentPromptsFromRepo.mjs`.

Partial image streaming during render is **off by default** (`coverImagePartialImages = 0` in API Usage admin). Set to 1–3 in superadmin settings to test progressive previews locally.

## Run the API

```bash
node index.js
```

Default port **8086** unless **`PORT`** overrides. Health check: **GET** `/` returns `API is running ....`.

## Seed data

The app does not auto-seed subscription plans. After creating a user via the client, you can insert **`Subscription`** and **`Subscriber`** documents using Mongo Express or `mongosh` — follow the sample documents in **`README.md`**.

## Where to read next

- `architecture/application-architecture.md` — route map
- `docs/api/contracts/api-overview.md` — auth and errors
- `docs/features/README.md` — backend feature map

The React frontend is a **separate package**; point it at this base URL when testing end-to-end.
