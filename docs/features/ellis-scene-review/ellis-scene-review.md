# Ellis Scene Review

## Summary

Writers upload a DOC/DOCX manuscript and receive per-scene structural and character feedback from the Ellis AI reviewer. Results are stored per novel and scene index for display in the writing workflow.

## Scope

**In scope:** Document upload review, EllisSceneReview persistence, fetching reviews by novel.

**Out of scope:** Olivia scene design, Olivia editor chat, general novel review (`reviewNovel`).

## Primary responsibilities

- Accept manuscript uploads (doc/docx, up to 50 MB).
- Invoke Ellis review pipeline via OpenAI.
- Store and retrieve per-scene review records (structure, character, suggestions).
- Enforce subscription and rate limits on review requests.

## Dependencies

- OpenAI API, multer doc upload on novel routes.
- EllisSceneReview model, ReviewPillar model.
- subscriptions-billing, rate limiting.

## How to navigate the code

- Routes: `POST /api/novel/ellis/review`, `GET /api/novel/ellis/reviews/:novelId`
- Controller: `controllers/novelController.js` (`ellisReview`, `getEllisSceneReviews`)
- Model: `models/ellisSceneReviewModel.js`, `reviewPillarModel.js`

## Open questions / gaps

- Frontend consumers include Book Editor and Final Draft flows in storygroove-fe.
