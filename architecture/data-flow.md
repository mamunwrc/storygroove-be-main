# Data flow — storygroove-be

## Authentication and session

1. Client **POST**s credentials to `/api/user/login` (or registers).
2. Server validates user, issues **JWT** (`User.createJWT()`).
3. Client stores the token and sends **`Authorization: Bearer <token>`** on subsequent calls.
4. **`authenticateUserWithoutOpenAI`** or **`authenticateUser`** loads `User` into **`req.user`**.

## Subscription gate

After authentication, routes that use **`isSubscribedUser`** load the user’s **Stripe customer** (if `stripeCustomerId` is set), fetch **active subscriptions**, and compare the active **price id** to configured **Builder** and **Studio** price env vars. **Admins** short-circuit as allowed. **POST `/api/v1/chat`** and **POST `/api/v1/thread`** apply **per-agent** entitlements (Ellis vs Olivia vs Simone credits).

## Novel lifecycle (simplified)

1. **Create**: `POST /api/novel/create` inserts a `Novel` linked to `req.user._id`.
2. **Generate / review**: `POST /api/novel/generate`, `/review`, etc. call OpenAI services and persist outputs (`StoryResponse`, updated `Novel` fields, etc.).
3. **Ellis**: upload DOC/DOCX → `POST /api/novel/ellis/review` → `EllisSceneReview` documents; list via **GET** `/api/novel/ellis/reviews/:novelId`.
4. **Olivia Scene Design**: upload → `POST /api/novel/olivia/scenes` → `OliviaSceneSuggestion`; read via **GET** `/api/novel/olivia/suggestions/:novelId`.
5. **User-authored content**: `UserContent` rows keyed by novel + prompt key via `POST/GET` `/api/novel/usercontent` routes.
6. **Manuscript**: `POST /api/novel/uploadmanuscript` stores binary in S3 and updates novel flags; **GET** `/api/novel/download/:novelId` reverses path.

## Agent chat (Responses API default)

1. **POST** `/api/v1/thread` creates a `Thread` with `threadId` and metadata.
2. **POST** `/api/v1/chat` appends user and assistant rows in `Message` and streams or returns model output via OpenAI **Responses** client.
3. **GET** `/api/v1/thread/:threadId` returns history; **GET** `/api/v1/threads` lists threads (includes legacy Assistants listing path for compatibility).

**Context (as of 2026-09):** dashboard Simone/Olivia chat still sends **full thread history** each turn (`DASHBOARD_CHAT_MEMORY_V2_ENABLED` is false). Olivia Book Editor uses Memory V2. Proposed change: [staged-ai-architecture.md](staged-ai-architecture.md).

## Olivia Writing Studio / memory pipeline (feature flag)

When **`OLIVIA_MEMORY_V2_ENABLED`** is enabled, **`POST /api/novel/:novelId/olivia-chat`** and **`olivia-scene-chat`** assemble context from **`StoryState`**, **`SceneMemory`**, episodic/edge retrieval, methodology bundles, and capped bible slices rather than sending unbounded outlines. Streaming uses **`chatWithResponsesAPIStream`** with the memory pipeline. Scene saves enqueue background memory updates (`memoryWorker`).

## Stripe billing

1. Client calls **`/api/stripe/*`** authenticated routes to create or change subscriptions or open billing portal.
2. **POST `/webhook`** receives Stripe events with verified signatures; **`stripeController.stripeWebhook`** updates `Subscriber`, `Invoice`, and related records.
3. Subsequent API calls observe updated entitlements via **`isSubscribedUser`**.

## Admin usage and audit

Superadmins hit **`/api/admin/usage/*`** for cost and limit dashboards (backed by `ApiUsageLog`, `ApiUsageSettings`, `RateLimitEvent`, etc.) and **`/api/admin/activity-logs`** for filtered `ActivityLog` views.
