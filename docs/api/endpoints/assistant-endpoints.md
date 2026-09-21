# Assistant endpoints — `/api/assistant`

Router: `routers/assistantRoute.js` → `assistantController.js`, `methodologyAdminController.js`.

## Setup / Simone key (superadmin for key routes)

| Method | Path | Authz | Handler |
|--------|------|-------|---------|
| POST | `/api/assistant/setup` | admin | `setupAssistant` |
| GET | `/api/assistant/simone/key` | superadmin | `getSimoneKey` |
| POST | `/api/assistant/simone/key` | superadmin | `upsertSimoneKey` |

## Agent prompts

| Method | Path | Authz | Handler |
|--------|------|-------|---------|
| GET | `/api/assistant/agent/prompts` | admin | `getAllAgentPrompts` |
| GET | `/api/assistant/agent/prompts/export` | admin | `exportAgentPromptsBundle` |
| POST | `/api/assistant/agent/prompts/import` | admin | `importAgentPromptsBundle` |
| POST | `/api/assistant/agent/prompt` | admin | `upsertAgentPrompt` |

## Methodology admin

| Method | Path | Authz | Handler |
|--------|------|-------|---------|
| GET | `/api/assistant/methodology/rules` | admin | `listMethodologyRules` |
| POST | `/api/assistant/methodology/rule` | admin | `upsertMethodologyRule` |
| DELETE | `/api/assistant/methodology/rule/:key` | admin | `deleteMethodologyRule` |
| GET | `/api/assistant/methodology/templates` | admin | `listPromptTemplates` |
| POST | `/api/assistant/methodology/template` | admin | `upsertPromptTemplate` |
| GET | `/api/assistant/methodology/overlays` | admin | `listGenreOverlays` |
| POST | `/api/assistant/methodology/overlay` | admin | `upsertGenreOverlay` |
| DELETE | `/api/assistant/methodology/overlay/:genreKey` | admin | `deleteGenreOverlay` |
| POST | `/api/assistant/methodology/audit` | admin | `auditMethodology` |
| GET | `/api/assistant/methodology/export` | admin | `exportMethodologyBundle` |
| POST | `/api/assistant/methodology/import` | admin | `importMethodologyBundle` |

## Legacy Assistants compatibility (JWT)

| Method | Path | Handler |
|--------|------|---------|
| POST | `/api/assistant/thread` | `createThread_old` |
| POST | `/api/assistant/message` | `sendMessage_old` |
| GET | `/api/assistant/threads` | `getUserThreads` |
| GET | `/api/assistant/thread/:threadId` | `getThreadHistory_old` |
