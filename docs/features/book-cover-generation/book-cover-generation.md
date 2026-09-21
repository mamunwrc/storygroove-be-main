# Book Cover Generation

## Summary

Writers use a conversational cover workspace in the Book Editor to explore author branding with Olivia, generate AI cover images, browse a per-novel version gallery, and set an active cover. Image renders are capped per user per billing period; cover chat is unlimited.

## Scope

**In scope:** Cover session API, cover chat, cover render, version gallery, activate version, quota enforcement, BookCoverModal UI, S3 storage.

**Out of scope:** Olivia editor/coaching chat integration, per-novel quota overrides.

## Primary responsibilities

- Olivia text coaching (`POST .../cover/chat`)
- Image generation on explicit render (`POST .../cover/render`)
- Version gallery (`NovelCoverVersion`) and quota (`coverRenderQuota.js`)

## How to navigate the code

- Controller: `controllers/coverController.js`
- Service: `service/coverGenerationService.js`
- Models: `models/novelCoverVersionModel.js`, `models/novelCoverMessageModel.js`
- Frontend: `storygroove-fe/src/component/BookCoverModal/`
