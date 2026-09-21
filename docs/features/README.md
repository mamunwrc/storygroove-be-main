# Feature Map — storygroove-be

Machine-friendly backend feature inventory for humans and automation (PR impact, onboarding, AI updates). Each feature has:

- `<feature-slug>.md` — human-readable description
- `<feature-slug>.paths.json` — repo-relative paths for scripts (`schema_version: "1"`)

Paths are relative to the **storygroove-be** repository root. For the full-stack map (including `storygroove-fe`), see the monorepo [`docs/features/README.md`](../../../docs/features/README.md).

Writer/operator journey (checkout → coaches → billing): [`docs/user-guide/README.md`](../user-guide/README.md).

## Route map (mounts)

| Mount | Router file | Primary features |
|-------|-------------|------------------|
| `POST /webhook` | `index.js` → `stripeController.js` | subscriptions-billing |
| `GET /userData/*` | `index.js` (S3 proxy) | s3-file-storage |
| `GET /backgrounds/*` | `index.js` (`express.static`) | Static assets (not a feature slug) |
| `/api/user` | `userRoute.js` | user-auth |
| `/api/novel` | `novelRoute.js` | novel-management, story-ai-generation, ellis-scene-review, olivia-scene-design, olivia-writing-studio, manuscript-upload, book-cover-generation |
| `/api/v1` | `chatRoute.js` | ai-agent-chat |
| `/api/assistant` | `assistantRoute.js` | agent-prompts-admin, methodology-admin (+ legacy Assistants thread/message routes) |
| `/api/stripe` | `stripeRoute.js` | subscriptions-billing |
| `/api/subscription` | `subscriptionRoute.js` | subscriptions-billing |
| `/api/admin/usage` | `apiUsageRoute.js` | api-usage-admin |
| `/api/admin/activity-logs` | `activityLogRoute.js` | activity-log-admin |

## `/api/novel` — route highlights

Novel mounts many handlers in `novelRoute.js` / `novelController.js`; use this map to see which **feature slug** owns a surface.

| Method | Path (under `/api/novel`) | Feature |
|--------|---------------------------|---------|
| POST | `/generate`, `/review`, `/character`, `/create-from-olivia`, `/generate-extras` | story-ai-generation |
| POST | `/ellis/review` · GET `/ellis/reviews/:novelId` | ellis-scene-review |
| POST | `/olivia/scenes` · GET `/olivia/suggestions/:novelId` | olivia-scene-design |
| POST | `/uploadmanuscript` | manuscript-upload |
| POST | `/:novelId/generate-cover` · GET `/:novelId/cover` | book-cover-generation |
| POST | `/:novelId/olivia-chat`, `/:novelId/olivia-scene-chat`, layering/rich scene, checkpoints | olivia-writing-studio |
| POST/GET/PATCH… | `/create`, CRUD scenes/characters/notes, download | novel-management |

## `/api/v1` — AI agent chat (Responses API default)

Mounted from `chatRoute.js`. Subscription + rate limit apply where noted.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/chat/upload` | Attach files for chat (multer → S3-style keys) |
| POST | `/chat` | Send message / stream reply |
| POST | `/thread` | Create thread |
| GET | `/thread/:threadId` · `/threads` | History and listing |
| GET | `/thread/by-simone/:simoneThreadId/olivia` | Olivia threads tied to Simone |
| PATCH | `/thread/:id/rename` · `/thread/:id/pin` | Thread metadata |
| DELETE | `/thread/:id` | Delete thread |
| POST | `/chat-old`, `/thread-old`, GET `/thread-old/:threadId` | Legacy Assistants API parity |

## `/api/assistant` — admin + legacy

See `assistantRoute.js`. Admin paths require `requireAdmin` / `requireSuperAdmin` as defined in `tokenverify.js`. Simone key and agent prompts = **agent-prompts-admin**; `/methodology/*` = **methodology-admin**. Legacy `POST /thread`, `/message`, `GET /threads`, `GET /thread/:threadId` remain for backward compatibility.

---

## Feature index

| Feature | Description | Docs |
|---------|-------------|------|
| [user-auth](user-auth/user-auth.md) | Login, registration, 2FA, profile, admin user management | [paths](user-auth/user-auth.paths.json) |
| [s3-file-storage](s3-file-storage/s3-file-storage.md) | S3 uploads and `/userData` asset proxy | [paths](s3-file-storage/s3-file-storage.paths.json) |
| [novel-management](novel-management/novel-management.md) | Novel CRUD, scenes, characters, notes, download | [paths](novel-management/novel-management.paths.json) |
| [story-ai-generation](story-ai-generation/story-ai-generation.md) | Story generate/review, character AI, create from Olivia | [paths](story-ai-generation/story-ai-generation.paths.json) |
| [ellis-scene-review](ellis-scene-review/ellis-scene-review.md) | Ellis per-scene manuscript review | [paths](ellis-scene-review/ellis-scene-review.paths.json) |
| [olivia-scene-design](olivia-scene-design/olivia-scene-design.md) | Olivia Scene Design from manuscript | [paths](olivia-scene-design/olivia-scene-design.paths.json) |
| [olivia-writing-studio](olivia-writing-studio/olivia-writing-studio.md) | Olivia editor/scene chat, layering, checkpoints | [paths](olivia-writing-studio/olivia-writing-studio.paths.json) |
| [olivia-bounded-context](olivia-bounded-context/olivia-bounded-context.md) | Memory V2 pipeline (context assembly, vector store); deep spec: [specification.md](olivia-bounded-context/specification.md) | [paths](olivia-bounded-context/olivia-bounded-context.paths.json) |
| [manuscript-upload](manuscript-upload/manuscript-upload.md) | DOCX manuscript import into novel/scenes | [paths](manuscript-upload/manuscript-upload.paths.json) |
| [book-cover-generation](book-cover-generation/book-cover-generation.md) | AI book cover generation and retrieval | [paths](book-cover-generation/book-cover-generation.paths.json) |
| [ai-agent-chat](ai-agent-chat/ai-agent-chat.md) | Simone/Olivia agent chat threads (Responses API) | [paths](ai-agent-chat/ai-agent-chat.paths.json) |
| [subscriptions-billing](subscriptions-billing/subscriptions-billing.md) | Stripe subscriptions, checkout, webhooks, price-based entitlements | [paths](subscriptions-billing/subscriptions-billing.paths.json) |
| [agent-prompts-admin](agent-prompts-admin/agent-prompts-admin.md) | Agent prompt CRUD, Simone key, bundle import/export | [paths](agent-prompts-admin/agent-prompts-admin.paths.json) |
| [methodology-admin](methodology-admin/methodology-admin.md) | Methodology rules, templates, genre overlays | [paths](methodology-admin/methodology-admin.paths.json) |
| [api-usage-admin](api-usage-admin/api-usage-admin.md) | Super-admin API usage dashboard and rate limits | [paths](api-usage-admin/api-usage-admin.paths.json) |
| [activity-log-admin](activity-log-admin/activity-log-admin.md) | Super-admin activity logs | [paths](activity-log-admin/activity-log-admin.paths.json) |

## Cross-cutting infrastructure

| Concern | Paths |
|---------|-------|
| Auth gating | `config/tokenverify.js` — JWT, `isSubscribedUser`, `requireAdmin`, `requireSuperAdmin` |
| Rate limiting | `middleware/checkRateLimit.js`, `utils/logApiUsage.js` |
| OpenAI (default) | `service/responsesApiService.js` |
| OpenAI (legacy) | `service/openaiService.js`, `controllers/assistantController.js` |
| Activity logging | `utils/queueActivityLog.js`, `constants/activityLog.js` |
| App bootstrap | `index.js` |

## Adding a feature

1. Create `docs/features/<feature-slug>/`
2. Add `<feature-slug>.md` and `<feature-slug>.paths.json` (see [AGENTS.md](../../AGENTS.md))
3. Add a row to the tables above
4. Mirror the feature in the monorepo `docs/features/` if the feature spans frontend and backend

## Optional deep specs

- [template.md](template.md) — template for `specification.md` when you need more than the inventory pair
