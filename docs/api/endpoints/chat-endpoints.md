# Chat endpoints — `/api/v1`

Router: `routers/chatRoute.js`. Default: **`chatController.js`**. Legacy: **`assistantController.js`** (`*_old`).

## Responses API (default)

| Method | Path | Notes | Handler |
|--------|------|-------|---------|
| POST | `/api/v1/chat/upload` | multipart `files` (max 5) | `uploadChatFile` |
| POST | `/api/v1/chat` | + `isSubscribedUser`, `checkRateLimit` | `sendMessage` |
| POST | `/api/v1/thread` | + `isSubscribedUser` | `createThread` |
| GET | `/api/v1/thread/by-simone/:simoneThreadId/olivia` | — | `getOliviaThreadsBySimone` |
| GET | `/api/v1/thread/:threadId` | — | `getThreadHistory` |
| GET | `/api/v1/threads` | lists via `getUserThreads` (Assistants controller) | `getUserThreads` |
| DELETE | `/api/v1/thread/:id` | — | `deleteThread` |
| PATCH | `/api/v1/thread/:id/rename` | — | `renameThread` |
| PATCH | `/api/v1/thread/:id/pin` | — | `pinThread` |

## Legacy (`*-old`)

| Method | Path | Handler |
|--------|------|---------|
| POST | `/api/v1/chat-old` | `sendMessage_old` |
| POST | `/api/v1/thread-old` | `createThread_old` |
| GET | `/api/v1/thread-old/:threadId` | `getThreadHistory_old` |

## Agent gating

For **POST** `/chat` and `/thread`, **`isSubscribedUser`** applies agent-specific entitlements (Ellis, Olivia, Simone/credits) — see `config/tokenverify.js`.
