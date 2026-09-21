# Story AI Generation

## Summary

Subscribed writers use OpenAI (Responses API by default) to generate story content from outlines, run novel-level reviews, generate characters, and create novels from Olivia chat responses. Rate limiting and subscription checks apply.

## Scope

**In scope:** `generateStory`, `reviewNovel`, `generateCharacter`, `createNovelFromOliviaResponse`, outline siblings by thread, legacy Assistants API routes (`*-old`).

**Out of scope:** Ellis scene review, Olivia scene design, Olivia editor/scene chat, agent thread chat.

## Primary responsibilities

- Call OpenAI Responses API (via `responsesApiService`) for story generation and review.
- Gate AI endpoints behind subscription and rate-limit middleware.
- Persist StoryResponse and related novel state after generation.
- Support creating a novel project from an Olivia agent conversation.

## Dependencies

- OpenAI API (`responsesApiService`, `openaiService`).
- Subscription gating (`isSubscribedUser`, Subscriber model).
- Rate limiting (`middleware/checkRateLimit.js`, `apiUsageLogModel`).
- novel-management for persisted novel/scene data.

## How to navigate the code

- Routes: `routers/novelRoute.js` (`/generate`, `/review`, `/character`, `/create-from-olivia`)
- Controller: `controllers/novelController.js`
- Services: `service/responsesApiService.js`, `openaiService.js`
- Model: `models/storyResponseModel.js`

## Open questions / gaps

- Assistants API legacy paths preserved but not the default code path.
