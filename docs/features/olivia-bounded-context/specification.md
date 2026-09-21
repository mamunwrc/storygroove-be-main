# Feature specification: Olivia bounded context (memory V2)

Paths in this document are relative to the **storygroove-be** repository root unless noted.

## Feature name

Olivia bounded context — layered memory and retrieval for Olivia editor and scene chat.

## Summary

When **`OLIVIA_MEMORY_V2_ENABLED`** is enabled, Olivia’s **editor** and **scene chat** paths avoid sending the full story bible, full outline, and full chat history on every turn. Instead, services resolve a **focus scene**, assemble **retrieval-ranked** memory sections within a **token budget**, add a **phase-aware master-prompt slice**, merge **dynamic supplements**, and **stream** via the Responses API with a memory-aware instruction layout.

## User stories / goals

- As a **writer**, I want Olivia to stay consistent with my story without exhausting the model context window.
- As an **operator**, I want enabling the flag to be predictable: clear env toggles, Mongo collections, and optional backfill scripts for older novels.

## Requirements

### Functional

- Resolve focus act/scene from explicit request body → `ActiveSceneState` → layering `nextLayeringTarget` → last filled `UserContent`, as implemented in `service/oliviaFocusResolver.js`.
- Assemble context via `service/contextAssembler.js` with methodology content and an approximately **8k-token** budget (see implementation for exact budgeting).
- Build bible slice through `service/masterPromptSlice.js` (phase-aware; avoids full dossiers in expansion/drafting modes per code comments).
- Merge dynamic material in `service/oliviaDynamicContext.js`, skipping redundant full outline when assembler output already includes `### OUTLINE SLICE`.
- Stream completion using `chatWithResponsesAPIStream` with `useMemoryPipeline` and windowed/chained history where configured.
- On **outline** scene save, insert, or sidebar Scene Design save (`saveOliviaScene`, `insertLayeredScene`, `updateSceneSuggestion`), enqueue memory maintenance via `service/memoryWorker.js` and `service/memoryQueue.js`. Draft auto-save (`POST /api/novel/usercontent`) does **not** trigger memory workers.

### Non-functional

- Respect Mongo document size and OpenAI latency; rank retrieval (`service/retrievalService.js`) instead of bulk prompts.
- Feature flags for vector store and checkpoints remain **out of scope** when those env toggles are off (`OLIVIA_NOVEL_VECTOR_STORE_ENABLED`, `OLIVIA_SCENE_CHECKPOINTS_ENABLED`).

## API endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/novel/:novelId/olivia-chat` | Olivia **editor** chat (`oliviaEditorChat`) |
| POST | `/api/novel/:novelId/olivia-scene-chat` | **Scene modal** chat (`oliviaSceneChat`) |
| GET | `/api/novel/:novelId/olivia-chat/history` | Editor transcript |
| GET | `/api/novel/:novelId/olivia-scene-chat/history` | Scene chat transcript |
| GET | `/api/novel/:novelId/olivia-layering/next-target` | Layering focus helper |

Subscription and auth middleware per `routers/novelRoute.js`.

## Database / schema

Primary collections (Mongoose models under `models/`):

- `StoryState`, `SceneMemory`, `EpisodicEvent`, `RelationshipEdge`
- `ActiveSceneState`, `ConversationCursor`, `CharacterState`
- `Novel` (vector store id, layering maps, thread ids)
- Methodology documents: `MethodologyRule`, `PromptTemplate`, `GenreOverlay`

## Dependencies

- **Env**: `OLIVIA_MEMORY_V2_ENABLED` and related flags in `constants/oliviaMemory.js` (and services referencing them).
- **OpenAI**: Responses API client stack in `service/responsesApiService.js` (and streaming helpers used by novel controller).
- **Methodology admin**: rules/templates/overlays served from Mongo and maintained via `/api/assistant/methodology/*`.

## Testing approach

- Unit tests in `__tests__/` cover pieces such as `masterPromptSlice`, `contextAssembler` token budgets, and outline layout utilities — run via project test script.
- Manual: toggle flag in dev, open Book Editor Olivia chat, verify stable latency and that scene saves enqueue worker jobs without errors in logs.

## Implementation notes

- Bootstrap lazy `StoryState` via `service/storyStateBootstrap.js` / `ensureStoryStateForNovel` patterns in controllers.
- Story bible vs `masterPrompt`: `Novel.storyBible` is the dossier-free bible used in assembly; see comments in `models/novelModel.js`.
- Checkpoints: `sceneCheckpointController.js` and routes under `/api/novel/:novelId/olivia-checkpoint*` when checkpoint flag is on.
- Seeded methodology JSON lives under `seed/olivia-methodology/` for local reference; production data is Mongo-backed.

## Changelog

- **2026-05-27** — Sidebar Scene Design save (`updateSceneSuggestion`) enqueues scene memory refresh; Olivia history GET endpoints support paginated `limit` / `before` / `hasMore`.
- **2026-05-26** — Added backend repository spec; aligned with monorepo outline in `docs/features/olivia-bounded-context/specification.md` (parent repo) and current services.

## Related inventory doc

See `docs/features/olivia-bounded-context/olivia-bounded-context.md` and `olivia-bounded-context.paths.json` for path maps and scope bullets.
