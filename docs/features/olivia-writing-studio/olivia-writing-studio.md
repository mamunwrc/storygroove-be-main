# Olivia Writing Studio

## Summary

In the Book Editor, writers interact with Olivia through editor chat, scene-by-scene chat, scene layering, rich scene generation (including streaming), blurb/synopsis generation, and optional scene checkpoints. This is the primary interactive Olivia writing workflow.

## Scope

**In scope:** Olivia editor chat, scene chat, layering state, insert layered scene, rich scene generation, save Olivia scene, blurb/synopsis, scene checkpoints (when enabled).

**Out of scope:** Batch scene design from manuscript upload (olivia-scene-design), Simone agent chat threads (ai-agent-chat), memory pipeline internals (olivia-bounded-context).

## Primary responsibilities

- Stream Olivia responses in editor and scene modal contexts.
- Track layering progress and next target scene for expansion.
- Generate and insert rich scene content into the outline.
- Persist chat history and saved scene output.
- Manage optional manual/auto scene checkpoints for rollback.

## Dependencies

- OpenAI Responses API streaming.
- olivia-bounded-context when `OLIVIA_MEMORY_V2_ENABLED` is true.
- Scene checkpoint controller and models when checkpoints enabled.
- Rate limits and subscription checks.

## How to navigate the code

- Routes: `/api/novel/:novelId/olivia-chat`, `olivia-scene-chat`, `olivia-layering/next-target`, `/scene/generate-rich*`, `/olivia-checkpoints/*`, `/generate-extras`
- Controller: `novelController.js`, `sceneCheckpointController.js`
- Services: `oliviaLayeringState.js`, `oliviaDynamicContext.js`, `oliviaFocusResolver.js`

## Open questions / gaps

- Checkpoint and vector-store features are gated by env flags.
