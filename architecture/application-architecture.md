# Application architecture — storygroove-be

## Entry point

**`index.js`** loads environment variables (`dotenv/config`), constructs the Express application, connects MongoDB, registers middleware and routes, and listens on **`PORT`** (default **8086**).

Important ordering:

1. **`POST /webhook`** — Stripe signature verification requires **`express.raw({ type: 'application/json' })`** before **`express.json()`** runs on those requests.
2. **CORS** — `origin` from **`CLIENT_URL`**, exposes `X-RateLimit-Warning` and `Content-Disposition`.
3. **JSON parser** — 10mb limit, applied via a small wrapper middleware.
4. **`GET /userData/*`** — streams objects from **`AWS_S3_BUCKET_NAME`** using `@aws-sdk/client-s3`.
5. **`GET /backgrounds/*`** — `express.static('backgrounds')` for local images only.
6. **Malformed JSON handler** — returns **400** for parse errors after `express.json()`.

## Route mounts

| Mount | Router file | Purpose |
|-------|-------------|---------|
| `/api/user` | `routers/userRoute.js` | Login/register/2FA, profile, tokens, OpenAI user key storage, admin-only user endpoints |
| `/api/novel` | `routers/novelRoute.js` | Novel CRUD, story AI, Ellis, Olivia Scene Design / Writing Studio, characters, notes, manuscript, covers, checkpoints |
| `/api/v1` | `routers/chatRoute.js` | Responses API chat (threads, messages, uploads) + legacy `-old` aliases |
| `/api/assistant` | `routers/assistantRoute.js` | Admin: assistant setup, Simone key, agent prompts, methodology CRUD; legacy Assistants thread/message |
| `/api/stripe` | `routers/stripeRoute.js` | Subscription create/change/cancel, portal, price list, Simone checkout, subscription DTOs |
| `/api/subscription` | `routers/subscriptionRoute.js` | Public subscription plan catalog |
| `/api/admin/usage` | `routers/apiUsageRoute.js` | Superadmin API usage and limits |
| `/api/admin/activity-logs` | `routers/activityLogRoute.js` | Superadmin activity log query |

## Layering

1. **Router** — binds path + HTTP method to **middleware chain** + **controller function**.
2. **Controller** — reads `req.body` / `req.params` / `req.query`, applies business rules, calls **services** and **models**, returns **`res.status().json()`** or streams.
3. **Service** — encapsulates SDK calls (OpenAI, Stripe, AWS) and reusable algorithms (Olivia memory assembly, retrieval ranking).
4. **Model** — Mongoose schema and statics/ methods for persistence.

## Cross-cutting middleware

| Middleware | Role |
|------------|------|
| `authenticateUserWithoutOpenAI` | JWT → `req.user` |
| `authenticateUser` | JWT + require `openaiKey` |
| `isSubscribedUser` | Stripe plan entitlements + agent-specific rules on selected routes |
| `requireAdmin` / `requireSuperAdmin` | RBAC |
| `checkRateLimit` | Soft rate limits / usage tracking on expensive AI routes |

## Related files

- Auth and entitlements: `config/tokenverify.js`, `service/stripeService.js`
- Uploads: `config/multer.js`
- S3 client: `config/s3Client.js`
