# Agent Prompts Administration

## Summary

Admins manage AI agent system prompts (Simone, Olivia, Ellis, etc.), export/import prompt bundles, and configure the Simone API key. Supports setup of legacy Assistants API assistants.

## Scope

**In scope:** Agent prompt CRUD, prompt bundle export/import, Simone key upsert (super admin), assistant setup.

**Out of scope:** Methodology rules/templates (methodology-admin), runtime chat (ai-agent-chat).

## Primary responsibilities

- Store and version agent prompts in AgentPrompt model.
- Allow admin UI to edit prompts and sync to database.
- Export/import prompt bundles for environment migration.
- Manage SimoneConfig for system-level Simone key.

## Dependencies

- Admin/super-admin auth (`requireAdmin`, `requireSuperAdmin`).
- AgentPrompt and SimoneConfig models.

## How to navigate the code

- Routes: `routers/assistantRoute.js` (`/agent/prompt*`, `/simone/key`, `/setup`)
- Controller: `controllers/assistantController.js`
- Models: `agentPromptModel.js`, `simoneConfigModel.js`

## Open questions / gaps

- Legacy Assistants API thread/message routes still mounted on assistant router for backward compatibility.
