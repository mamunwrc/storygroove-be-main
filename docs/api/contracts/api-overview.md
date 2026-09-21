# API overview — storygroove-be

Base URL examples: **`http://localhost:8086`** (dev default) or production host. Paths below omit the host.

## Global behavior

| Topic | Detail |
|-------|--------|
| Payload format | **JSON** for most endpoints (`Content-Type: application/json`). Upload routes use **`multipart/form-data`**. Stripe webhook expects raw JSON bytes.|
| Body size | **10mb** Express JSON limit (see `index.js`).|
| Parsing errors | Malformed JSON returns **400** with message `"request data is malformed, Please send proper data"`.|

## Authentication

Send header:

```http
Authorization: Bearer <jwt>
```

Unless the endpoint is explicitly public (**login/register**, some Stripe catalog routes, **`/api/subscription/list`**).

Middleware variants:

- **`authenticateUserWithoutOpenAI`** — validates JWT and sets **`req.user`**. Majority of authenticated routes.
- **`authenticateUser`** — JWT plus **`user.openaiKey`** must exist (**403** otherwise). Rare (legacy Assistants flow such as **`deleteProject`**).
- **`isSubscribedUser`** — after auth (when applied), requires **Stripe Builder/Studio entitlements** from active subscription **`price.id`**, comparing to env **`PRICE_BUILDER_*`**, **`PRICE_STUDIO_*`**, **`PRICE_BUILDER_LEGACY_IDS`**. **`admin`** / **`superadmin`** bypass inside this middleware. **Additional rules** apply to **POST `/api/v1/chat`** and **POST `/api/v1/thread`** for **`agentName`** (Ellis, Olivia, Simone / credits)—see **`config/tokenverify.js`**.
- **`requireAdmin`** — role **`admin`** or **`superadmin`**.
- **`requireSuperAdmin`** — role **`superadmin`** only (`/api/admin/*`, Simone key helpers, sensitive imports).

Public catalog examples:

- **`GET /api/subscription/list`** — no auth middleware on router.
- **`GET /api/subscription/v2/list`** — DTO-shaped response, no auth.
- **`GET /api/stripe/get-price-list`** — no **`authenticateUserWithoutOpenAI`** in route file.

## Typical error JSON

| Status | Example body |
|--------|----------------|
| 401 | `{ "error": "No authorization headers sent" }` |
| 401 | `{ "error": "Token expired", "message": "jwt expired" }` |
| 403 | `{ "error": "Subscription required. Please subscribe to continue." }` |
| 403 | `{ "error": "OpenAI key not found for user" }` |

Exact strings vary slightly by middleware branch.

## Pagination and limits

Several admin controllers accept **`page`**, **`limit`**, **`search`**, **`sort`** — see **`../endpoints/admin-endpoints.md`**.

## CORS

Browser calls from the landing page require the landing **origin** to be allowed:

| Variable | Purpose |
|----------|---------|
| `CLIENT_URL` | Story Groove app origin (always allowed) |
| `PUBLIC_CHECKOUT_ORIGINS` | Comma-separated extra origins (e.g. production marketing domain) |
| `PUBLIC_CHECKOUT_ORIGIN_SUFFIXES` | Optional comma-separated suffixes (e.g. `.lovableproject.com`) |

**Built-in:** origins ending in `.lovableproject.com` are allowed by default (Lovable preview hosts).

`X-RateLimit-Warning` and `Content-Disposition` may be exposed to browsers.
