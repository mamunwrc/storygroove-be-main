# Novel endpoints — `/api/novel`

Mounted in `routers/novelRoute.js` → `novelController.js` (and `sceneCheckpointController.js` for checkpoints). Unless noted, routes use **`authenticateUserWithoutOpenAI`**; many also require **`isSubscribedUser`** or **`checkRateLimit`** as wired in the router.

| Method | Path | Middleware / notes | Handler (controller) |
|--------|------|--------------------|----------------------|
| POST | `/api/novel/generate` | + `isSubscribedUser`, `checkRateLimit` | `generateStory` |
| POST | `/api/novel/review` | + `isSubscribedUser`, `checkRateLimit` | `reviewNovel` |
| POST | `/api/novel/create` | + `isSubscribedUser` | `createNovel` |
| POST | `/api/novel/create-from-olivia` | + `isSubscribedUser` | `createNovelFromOliviaResponse` |
| GET | `/api/novel/by-thread/:threadId/outlines` | — | `getOutlineSiblingsByThread` |
| POST | `/api/novel/ellis/review` | + `isSubscribedUser`, Multer `document`, `checkRateLimit` | `ellisReview` |
| GET | `/api/novel/ellis/reviews/:novelId` | + `isSubscribedUser` | `getEllisSceneReviews` |
| POST | `/api/novel/olivia/scenes` | + `isSubscribedUser`, Multer `document`, `checkRateLimit` | `oliviaScenesReview` |
| GET | `/api/novel/olivia/suggestions/:novelId` | + `isSubscribedUser` | `getOliviaSceneSuggestions` |
| POST | `/api/novel/update` | + `isSubscribedUser` | `updateNovel` |
| GET | `/api/novel/list` | — | `getUserNovels` |
| POST | `/api/novel/character` | + `isSubscribedUser`, `checkRateLimit` | `generateCharacter` |
| POST | `/api/novel/usercontent` | + `isSubscribedUser` | `saveUserContent` — optional `expectedUpdatedAt` (409 `STALE_CONTENT` if stale); `force: true` overwrites |
| POST | `/api/novel/scene/rename` | + `isSubscribedUser` | `renameScene` |
| DELETE | `/api/novel/scene/:id` | + `isSubscribedUser` | `deleteScene` |
| GET | `/api/novel/usercontent/id/:id` | + `isSubscribedUser` | `getUserContentById` |
| GET | `/api/novel/usercontent/:novelId/:promptKey` | + `isSubscribedUser` | `getUserContent` |
| GET | `/api/novel/character/list/:novelId` | + `isSubscribedUser` | `getAllCharacters` |
| GET | `/api/novel/character/:characterId` | + `isSubscribedUser` | `getCharacterDetails` |
| PUT | `/api/novel/character/:characterId` | + `isSubscribedUser` | `updateCharacter` |
| POST | `/api/novel/:novelId/character/manual` | + `isSubscribedUser` | `createManualCharacter` — 17-point template; 409 on duplicate name; multiple leads allowed |
| PUT | `/api/novel/:novelId/master-prompt` | + `isSubscribedUser` | `updateMasterPrompt` |
| PUT | `/api/novel/:novelId/story-bible` | + `isSubscribedUser` | `updateStoryBible` |
| GET | `/api/novel/recent` | Must precede ``/:novelId`` | `getMostRecentNovel` |
| GET | `/api/novel/:novelId` | + `isSubscribedUser` | `getNovelDetails` |
| GET | `/api/novel/review/:novelId` | + `isSubscribedUser` | `getNovelReviewDetails` |
| POST | `/api/novel/note` | + `isSubscribedUser` | `addNote` |
| GET | `/api/novel/note/:novelId` | + `isSubscribedUser` | `getNote` |
| POST | `/api/novel/scene/add` | + `isSubscribedUser` | `addScene` |
| POST | `/api/novel/scene/reorder` | + `isSubscribedUser` | `reorderScene` |
| POST | `/api/novel/scene/insert` | + `isSubscribedUser` | `insertLayeredScene` |
| POST | `/api/novel/scene/generate-rich` | + `isSubscribedUser`, `checkRateLimit` | `generateRichScene` |
| POST | `/api/novel/scene/generate-rich-stream` | + `isSubscribedUser`, `checkRateLimit` | `generateRichSceneStream` |
| PUT | `/api/novel/scene/suggestion` | + `isSubscribedUser` | `updateSceneSuggestion` |
| POST | `/api/novel/uploadmanuscript` | + `isSubscribedUser`, Multer `document` | `uploadManuscript` |
| GET | `/api/novel/:novelId/editorial-letter` | + `isSubscribedUser`, `requireStudioForEllis` | `getEditorialLetter` |
| POST | `/api/novel/:novelId/editorial-letter/regenerate` | + `isSubscribedUser`, `requireStudioForEllis` | `regenerateEditorialLetter` |
| POST | `/api/novel/:novelId/editorial-letter/chat` | + `isSubscribedUser`, `requireStudioForEllis` | `ellisEditorialLetterChat` (SSE) |
| POST | `/api/novel/:novelId/editorial-letter/save` | + `isSubscribedUser`, `requireStudioForEllis` | `saveEllisEditorialLetter` |
| POST | `/api/novel/:novelId/olivia-scene-chat` | + `isSubscribedUser` | `oliviaSceneChat` |
| GET | `/api/novel/:novelId/olivia-scene-chat/history` | + `isSubscribedUser` | `getOliviaSceneChatHistory` |
| POST | `/api/novel/:novelId/olivia-save-scene` | + `isSubscribedUser` | `saveOliviaScene` |
| POST | `/api/novel/generate-extras` | + `isSubscribedUser`, `checkRateLimit` | `generateBlurbAndSynopsis` |
| POST | `/api/novel/:novelId/olivia-chat` | + `isSubscribedUser` | `oliviaEditorChat` |
| GET | `/api/novel/:novelId/olivia-chat/history` | + `isSubscribedUser` | `getOliviaEditorHistory` |
| GET | `/api/novel/:novelId/olivia-layering/next-target` | + `isSubscribedUser` | `getOliviaLayeringState` |
| DELETE | `/api/novel/:novelId` | auth only | `deleteNovel` |
| PATCH | `/api/novel/complete/:novelId` | + `isSubscribedUser` | `completeNovel` |
| GET | `/api/novel/download/:novelId` | — | `downloadManuscript` |
| GET | `/api/novel/download-outline/:novelId` | — | `downloadOutline` |
| POST | `/api/novel/:novelId/generate-cover` | + `isSubscribedUser`, `checkRateLimit` | `generateBookCover` (alias → `renderBookCover`) |
| GET | `/api/novel/:novelId/cover` | + `isSubscribedUser` | `getBookCover` |
| GET | `/api/novel/:novelId/cover/session` | + `isSubscribedUser` | `getCoverSession` |
| POST | `/api/novel/:novelId/cover/chat` | + `isSubscribedUser`, `checkRateLimit` | `coverChat` |
| POST | `/api/novel/:novelId/cover/render` | + `isSubscribedUser`, `checkRateLimit` | `renderBookCover` |

## Legacy Assistants (`-old`)

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/novel/generate-old` | + `isSubscribedUser` |
| POST | `/api/novel/review-old` | + `isSubscribedUser` |
| POST | `/api/novel/create-from-olivia-old` | + `isSubscribedUser` |
| POST | `/api/novel/ellis/review-old` | Multer + `isSubscribedUser` |
| POST | `/api/novel/olivia/scenes-old` | Multer + `isSubscribedUser` |
| POST | `/api/novel/character-old` | + `isSubscribedUser` |

## Scene checkpoints (`sceneCheckpointController.js`)

| Method | Path |
|--------|------|
| GET | `/api/novel/:novelId/olivia-checkpoints` |
| POST | `/api/novel/:novelId/olivia-checkpoint` |
| POST | `/api/novel/:novelId/olivia-checkpoint/:checkpointId/restore` |
| DELETE | `/api/novel/:novelId/olivia-checkpoint/:checkpointId` |

All use + `isSubscribedUser`.

## Olivia chat history pagination

Both **`GET /api/novel/:novelId/olivia-scene-chat/history`** and **`GET /api/novel/:novelId/olivia-chat/history`** accept optional query parameters (backward compatible):

| Param | Default | Meaning |
|-------|---------|---------|
| `limit` | `50` | Max messages in the page (tail / most recent when `before` is omitted). Clamped to 200. |
| `before` | — | Mongo `_id` of the oldest message the client already has **for that thread**; returns the next older page. |

Response shape (existing fields plus pagination):

```json
{
  "messages": [],
  "threadId": "...",
  "hasMore": true,
  "layeringState": {}
}
```

`layeringState` is returned only on the **editor** history endpoint. Messages within a page are chronological (ascending). Implementation: `service/oliviaThreadHistory.js` (`fetchThreadMessagePage`).

## Editorial letter (Ellis Phase 1 — consent / refine / save)

Not auto-generated on upload. After `uploadManuscript`, `Novel.editorialLetterStatus = "pending"`. The Manuscript Hub shows a blocking modal: **Consent → Generate (SSE) → Refine (chat, full-letter regenerate) → Save**. Status lifecycle: `pending → generating → draft → ready` (`failed` on error); `ready` now means the writer **saved** the letter. Scene-by-scene chat (`reviewIntent: "chapter_review"`, FAB, "Start Chapter N") is locked until `ready`.

- **`POST .../editorial-letter/chat`** — SSE (`token`/`done`/`error` frames). Omit `message` for the first draft; pass writer feedback to refine. Manuscript + current draft are sent as ephemeral model input; persisted thread rows (`ellisEditorialLetterThreadId`) carry `metadata.excludeFromModelInput: true` (kinds `ellis_editorial_letter_refine` / `ellis_editorial_letter_draft`). Completion saves `editorialLetterDraft`, status → `draft`.
- **`POST .../editorial-letter/save`** — copies `editorialLetterDraft` → `editorialLetter`, status → `ready`, sets `editorialLetterGeneratedAt`, triggers Manuscript Map enrichment. Optional body `letter` overrides the draft.
- **`GET .../editorial-letter`** — returns `{ status, editorialLetter, editorialLetterDraft, error, generatedAt }`.

## Upload field names

- Manuscript / Ellis / Olivia DOCX: multipart field **`document`**.
