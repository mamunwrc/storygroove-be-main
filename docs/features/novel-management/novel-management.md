# Novel Management

## Summary

Writers create and manage novel projects: metadata, scenes, notes, characters, in-editor user content, master prompt, story bible, completion status, and manuscript download. Data is scoped per authenticated user.

## Scope

**In scope:** Novel CRUD, scene add/rename/reorder/delete, notes, character list/details/update/manual create, user content by promptKey, master prompt and story bible updates, novel completion, manuscript download.

**Out of scope:** AI generation (story-ai-generation), Ellis/Olivia reviews, Olivia editor chat, book cover generation.

## Primary responsibilities

- Persist novel metadata (name, book idea, genre, acts, settings).
- Manage hierarchical scene structure and user-written content per scene.
- Maintain character records (protagonist, antagonist, supporting). Multiple leads of the same type are allowed; names must be unique per novel.
- Store notes and prompt-keyed user content for the writing workflow.
- Mark novels complete and export manuscripts.

## Dependencies

- MongoDB: Novel, Character, Notes, UserContent models.
- User authentication (user-auth).

## How to navigate the code

- Routes: `routers/novelRoute.js` (non-AI handlers in `novelController.js`)
- Controller: `controllers/novelController.js`
- Character create/upsert: `service/characterService.js`, template: `utils/characterDossierTemplate.js`
- Models: `models/novelModel.js`, `characterModel.js`, `notesModel.js`, `userContentModel.js`

## Open questions / gaps

- Legacy Assistants API routes (`*-old` suffix) remain for backward compatibility.
