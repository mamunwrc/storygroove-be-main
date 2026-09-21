# Security architecture — storygroove-be

## Threat model (concise)

The API is exposed to the public internet in production. Primary risks: **token theft**, **IDOR** on novel/thread routes, **webhook forgery**, **prompt injection** (handled mostly at app/business layer), and **upload abuse**.

## Authentication

- **JWT** in `Authorization: Bearer`. Secret: **`JWT_SECRET`**. Expiry: **`JWT_LIFETIME`** (see `models/user.js`).
- Invalid, expired, or missing tokens → **401** JSON from `config/tokenverify.js`.

## Authorization layers

1. **Authentication** — attach `req.user`.
2. **Subscription** — `isSubscribedUser` enforces **Stripe Builder/Studio** price ids (from env) unless user is **admin** or **superadmin**. Additional rules apply to **POST** `/api/v1/chat` and `/api/v1/thread` for **Ellis** (Studio), **Olivia** (Builder+), and **Simone** (paid or one-time credit).
3. **Role-based** — `requireAdmin` for methodology and agent prompts; `requireSuperAdmin` for Simone key, `/api/admin/usage`, `/api/admin/activity-logs`.
4. **Resource ownership** — controllers must filter **`user`**, **`userId`**, `novel.user`, and thread ownership consistently.

## Sensitive data

- **Passwords**: bcrypt hashing on the `User` model; never return password hashes.
- **OpenAI keys**: stored as `User.openaiKey`; only used server-side after auth; **`authenticateUser`** gates legacy flows that rely on **per-user** keys.
- **Stripe**: store **customer id** on user; webhook updates subscription state; no raw PAN data.

## Webhook integrity

Stripe webhook uses **signature verification** and **raw body** parsing mounted before JSON middleware (`index.js`).

## Upload and static content

Multer restricts file types/sizes where configured (e.g. DOC/DOCX for Ellis/Olivia). The **`/userData/*`** proxy only serves **S3 keys** derived from the URL path—no arbitrary filesystem reads.

## Transport and CORS

Use **HTTPS** in production. CORS allows the configured **`CLIENT_URL`** origin with credentials.

## Operational hygiene

Rotate **`JWT_SECRET`**, Stripe keys, and AWS credentials on compromise. Restrict MongoDB network access and enable TLS for managed clusters.
