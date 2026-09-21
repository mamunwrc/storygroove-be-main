# Methodology Administration

## Summary

Admins configure Olivia's methodology layer: rules, prompt templates, and genre overlays. Supports audit, export, and import of methodology bundles for consistent AI coaching behavior.

## Scope

**In scope:** Methodology rules CRUD, prompt template CRUD, genre overlay CRUD, audit, bundle export/import.

**Out of scope:** Agent persona prompts (agent-prompts-admin), runtime context assembly (olivia-bounded-context).

## Primary responsibilities

- Persist methodology rules, templates, and genre-specific overlays.
- Serve methodology content to Olivia context assembly at runtime.
- Expose admin APIs for editing and auditing methodology configuration (consumed by storygroove-fe admin UI).

## Dependencies

- Admin auth, MethodologyRule, PromptTemplate, GenreOverlay models.
- methodologyService used by Olivia memory pipeline.

## How to navigate the code

- Routes: `routers/assistantRoute.js` (`/methodology/*`)
- Controller: `controllers/methodologyAdminController.js`
- Service: `service/methodologyService.js`
- Models: `methodologyRuleModel.js`, `promptTemplateModel.js`, `genreOverlayModel.js`

## Open questions / gaps

- Methodology audit endpoint validates consistency but does not auto-fix issues.
