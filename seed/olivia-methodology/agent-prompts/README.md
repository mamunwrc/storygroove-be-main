# AgentPrompt seed sources

**Preferred** — sync all Olivia AgentPrompt rows to Mongo (shows in admin **Agent Prompts**):

```bash
cd storygroove-be
node scripts/syncOliviaAgentPromptsFromRepo.mjs
```

Alternative (methodology seed bundle; editor/scene also use repo `.txt`):

```bash
node scripts/seedMethodologyFromJson.js --apply-agentprompt-slim
```

## Source of truth by agent

| `agentName` | File | Location |
|-------------|------|----------|
| `olivia_editor` | `olivia-editor.txt` | **Repo root** (authoritative — not slim) |
| `olivia_scenes` | `olivia-scene.txt` | **Repo root** (authoritative — not slim) |
| `olivia_coaching` | `olivia-coaching.txt` | **Repo root** (authoritative — not slim) |

`olivia_editor.slim.md`, `olivia_scenes.slim.md`, and `olivia_coaching.slim.md` are **ignored** when the matching repo-root `.txt` files exist.

## Behaviour

1. Upsert `olivia-editor.txt` → `AgentPrompt(olivia_editor)`.
2. Upsert `olivia-scene.txt` → `AgentPrompt(olivia_scenes)`.
3. Upsert any other `*.slim.md` in this folder (e.g. `olivia_coaching`).
4. Create missing rows so new agents appear in the admin **Agent Prompts** tab.

Re-runs are idempotent (unchanged prompt text → skip). On update, the previous `prompt` is stashed in `description` with a backup marker.

Optional audit (methodology rules must not duplicate parsing-sensitive UI strings):

```bash
node scripts/seedMethodologyFromJson.js --audit-constants
```
