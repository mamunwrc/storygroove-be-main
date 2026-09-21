# Manuscript Upload

## Summary

Writers upload an existing manuscript file to create or populate a novel project. The backend parses the document into novel and scene structure and marks the novel as uploaded.

## Scope

**In scope:** `POST /api/novel/uploadmanuscript`, multer file handling, parse into novel/scene structure.

**Out of scope:** Ellis/Olivia review of uploaded docs (separate features), upload viewer UI (storygroove-fe).

## Primary responsibilities

- Accept manuscript file upload (multer memory storage).
- Parse document content into novel and scene structure.
- Flag novel as uploaded for downstream editor routing.

## Dependencies

- novel-management (`uploadManuscript` in novelController).
- Multer file upload on novel routes.

## How to navigate the code

- Backend: `POST /api/novel/uploadmanuscript` in `novelRoute.js`

## Open questions / gaps

- Parsing behavior and supported file types are defined in `novelController.uploadManuscript`.
