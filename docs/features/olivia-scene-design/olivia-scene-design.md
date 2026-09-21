# Olivia Scene Design

## Summary

Writers upload a manuscript and receive per-scene **Scene Design** coaching from Olivia. Suggestions are stored as OliviaSceneSuggestion records and can be updated from the UI. Shown in the app as "Scene Design."

## Scope

**In scope:** Manuscript-based Olivia scenes review, suggestion CRUD, fetching suggestions by novel.

**Out of scope:** Olivia editor chat, scene-by-scene modal chat, layering workflow, bounded-context memory pipeline.

## Primary responsibilities

- Accept doc/docx uploads for batch scene design generation.
- Persist OliviaSceneSuggestion per novel and scene index.
- Allow updating scene suggestion content from the editor.
- Enforce subscription and rate limits.

## Dependencies

- OpenAI API, OliviaSceneSuggestion model.
- subscriptions-billing, rate limiting.
- novel-management for novel/scene structure.

## How to navigate the code

- Routes: `POST /api/novel/olivia/scenes`, `GET /api/novel/olivia/suggestions/:novelId`, `PUT /api/novel/scene/suggestion`
- Controller: `novelController.js` (`oliviaScenesReview`, `getOliviaSceneSuggestions`, `updateSceneSuggestion`)
- Model: `models/oliviaSceneSuggestionModel.js`

## Open questions / gaps

- Legacy Assistants API route available at `/olivia/scenes-old`.
