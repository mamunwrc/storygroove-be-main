# Olivia Bounded Context (Memory V2)

## Summary

When `OLIVIA_MEMORY_V2_ENABLED` is true, Olivia editor and scene chat use layered memory instead of sending the full story bible, outline, and chat history on every turn. Context is assembled within a token budget from story state, scene memory, episodic events, and methodology.

## Scope

**In scope:** Focus resolution, context assembly, master prompt slicing, dynamic context merge, retrieval ranking, story state bootstrap, memory worker/queue.

**Out of scope:** Vector store (`OLIVIA_NOVEL_VECTOR_STORE_ENABLED`), checkpoints (`OLIVIA_SCENE_CHECKPOINTS_ENABLED`) when flags are off.

## Primary responsibilities

- Resolve the active focus scene for Olivia turns.
- Assemble bounded context sections (~8k token budget).
- Rank and retrieve episodic events and relationship edges.
- Bootstrap and maintain StoryState, SceneMemory, CharacterState records.
- Invalidate memory when novel content changes.

## Dependencies

- Env flag `OLIVIA_MEMORY_V2_ENABLED`.
- MongoDB memory models (StoryState, SceneMemory, EpisodicEvent, etc.).
- methodology-admin for rules and templates.

## How to navigate the code

- Services: `service/contextAssembler.js`, `retrievalService.js`, `masterPromptSlice.js`, `memoryService.js`, `memoryWorker.js`, `storyStateBootstrap.js`
- Models: `storyStateModel.js`, `sceneMemoryModel.js`, `episodicEventModel.js`, `relationshipEdgeModel.js`, `activeSceneStateModel.js`, `conversationCursorModel.js`, `characterStateModel.js`
- Entry API: `POST /api/novel/:novelId/olivia-chat`, `POST /api/novel/:novelId/olivia-scene-chat`
- Extended spec (this repo): `docs/features/olivia-bounded-context/specification.md`

## Open questions / gaps

- Backfill SOP required when enabling memory V2 on existing novels.
