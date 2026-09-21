# AI Agent Chat

## Summary

Subscribed writers chat with AI agents (Simone, Olivia) via threaded conversations using the OpenAI Responses API. Supports file uploads, thread rename/pin/delete, and linking Olivia threads to Simone sessions.

## Scope

**In scope:** Thread create/list/history/delete/rename/pin, send message, chat file upload, Olivia threads by Simone thread.

**Out of scope:** Olivia in-editor chat (olivia-writing-studio), legacy Assistants API default paths, agent prompt admin.

## Primary responsibilities

- Manage chat threads and messages per user and agent.
- Stream or return agent responses via Responses API.
- Enforce subscription and rate limits on chat.
- Support multi-file chat uploads.

## Dependencies

- OpenAI Responses API (`chatController`, `responsesApiService`).
- Thread and Message models, UserAgent model.
- subscriptions-billing, rate limiting.

## How to navigate the code

- Routes: `routers/chatRoute.js` (mounted at `/api/v1`)
- Controller: `controllers/chatController.js`
- Legacy: `assistantController.js` for `-old` routes
- Models: `threadModel.js`, `messageModel.js`, `userAgentModel.js`

## Open questions / gaps

- Simone thread limits enforced via frontend modal and backend session constants.
