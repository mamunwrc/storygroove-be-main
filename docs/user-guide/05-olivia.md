# 5. Olivia (API)

Writer view: `storygroove-fe/docs/user-guide/05-olivia-story-bible-and-drafting.md`.

## Story Bible thread

Same chat stack as Simone: `POST /api/v1/thread` `{ agentName: "olivia" }`, then `POST /api/v1/chat`. Requires Builder or Studio.

Completion is **not** a backend flag. The FE treats a message containing `CHARACTER DOSSIERS` (and `📘 Story Bible` for copy) as done.

## Create novel from Bible

`POST /api/novel/create-from-olivia`

Builds the novel + 15-scene outline from the combined Story Bible text and `sourceThreadId`. Duplicate title / existing outline are returned as structured errors the FE maps to **Outline Already Exists**.

## Writing studio

JWT + subscription. Principal routes under `/api/novel`:

| Purpose | Path (prefix `/api/novel`) |
|---|---|
| Editor chat | `POST /:novelId/olivia-chat` |
| Scene chat | `POST /:novelId/olivia-scene-chat` |
| Scene design batch | `POST /olivia/scenes` · `GET /olivia/suggestions/:novelId` |
| Layering / rich scene / checkpoints | see `docs/features/olivia-writing-studio/` |
| Download manuscript | `GET /download/:id` |
| Download outline | `GET /download-outline/:id` |

Memory / context assembly: `docs/features/olivia-bounded-context/`.

Pause/cancel: same 403 `SUBSCRIPTION_PAUSED` as other agents.

## Related

- `routers/novelRoute.js`
- `docs/api/endpoints/novel-endpoints.md`
- `docs/features/olivia-writing-studio/`, `olivia-scene-design/`, `story-ai-generation/`

Next: [Ellis](06-ellis.md)
