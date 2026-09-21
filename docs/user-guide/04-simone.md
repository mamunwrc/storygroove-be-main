# 4. Simone (API)

Writer view: `storygroove-fe/docs/user-guide/04-simone-story-starter-kit.md`.

## Create a kit thread

`POST /api/v1/thread` `{ agentName: "simone", title }` after JWT + `isSubscribedUser`.

If the user is not on Builder/Studio, `consumeSimoneCreditIfRequired` atomically decrements `simoneCreditsRemaining` and increments `simoneKitsUsed`. Failure → `SIMONE_CREDIT_REQUIRED`.

Credits are granted on `checkout.session.completed` when the session includes `SIMONE_ONETIME_PRICE`.

There is no backend `SIMONE_THREAD_LIMIT` code. The FE modal still handles a legacy string; live errors are payment/credit based.

## Chat

`POST /api/v1/chat` streams via Responses API (`service/responsesApiService.js`). Files: `POST /api/v1/chat/upload`.

If thread `sessionCost` exceeds `ApiUsageSettings.simoneSessionSpendCap` (default **$3.00**, `constants/simoneSession.js`), the thread is `simonePaused`. Further chat is blocked; the writer sees the scope-pause message pointing them to Ellis.

## Handoff to Olivia

FE `POST /api/v1/thread` with `agentName: "olivia"`, `starterKitContent`, `simoneThreadId`. Backend stores a hidden user message `metadata.isStarterKit: true`. List Olivia threads for a kit: `GET /api/v1/thread/by-simone/:simoneThreadId/olivia`.

Olivia thread create still requires Builder/Studio via `isSubscribedUser`.

## Related

- `controllers/chatController.js`
- `routers/chatRoute.js`
- `docs/api/endpoints/chat-endpoints.md`
- `docs/features/ai-agent-chat/`

Next: [Olivia](05-olivia.md)
