# Backfill Olivia Memory

When enabling `OLIVIA_MEMORY_V2_ENABLED` on existing novels, run the backfill script so `StoryState`, `SceneMemory`, and related records exist.

## Script

```bash
node scripts/backfillOliviaMemory.js
```

Review script options and env in `scripts/backfillOliviaMemory.js` before running against production.

## Deploy checklist (Olivia context scalability)

After deploying bounded-context changes:

1. Run backfill for active beta novels: `node scripts/backfillOliviaMemory.js`
2. Reset stale response chains (one-time): `node scripts/resetOliviaResponseChains.js`
3. Monitor `ApiUsageLog` P95 `promptTokens` for endpoints `olivia-editor-chat` and `olivia-scene-chat` (target P95 under 40k)
4. Confirm `OLIVIA_FULL_CANON_CONTEXT_ENABLED` is `false` in `constants/oliviaMemory.js`

## Related code

- `service/storyStateBootstrap.js`, `service/memoryWorker.js`, `service/memoryService.js`
- Feature: `docs/features/olivia-bounded-context/`
- Spec: `docs/features/olivia-bounded-context/specification.md`
