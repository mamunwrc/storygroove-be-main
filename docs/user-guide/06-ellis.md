# 6. Ellis (API)

Writer view: `storygroove-fe/docs/user-guide/06-ellis-manuscript-review.md`.

## Gate

Studio prices only (`requireStudioForEllis` / `isSubscribedUser`). Builder receives 403 *Ellis requires a Studio subscription.*

## Upload

`POST /api/novel/uploadmanuscript` (multipart). Creates a novel with `uploaded: true` and imported scenes. FE accepts .doc/.docx/.pdf/.txt up to 50 MB; enforce server-side limits in the upload handler as configured.

Writer then uses `/dashboard/upload/bookeditor/:id`.

## Reviews and letter

| Purpose | Path |
|---|---|
| Trigger / store scene reviews | `POST /api/novel/ellis/review` · `GET /api/novel/ellis/reviews/:novelId` |
| Revision plan | `/api/novel/:id/revision-plan` (populated when FE **Insert to Revision Plan**) |
| Chapter editing plan download | FE **Download Editing Plan** — 404 if no inserted reviews |

Editorial letter and manuscript map generation are part of the Ellis novel pipeline (see `docs/features/ellis-scene-review/` and `manuscript-upload/`).

`RevisionPlanPanel` on the FE is unused. Live insert path is Ellis chat → revision-plan API.

## Related

- `docs/features/ellis-scene-review/`
- `docs/features/manuscript-upload/`
- `docs/api/endpoints/novel-endpoints.md`

Next: [Subscription lifecycle](07-subscription-lifecycle.md)
