# Cursor Rules Directory

This directory configures how Cursor AI behaves in this project.

## Contents

- **`rules/*.mdc`** – Rule files that Cursor applies when editing or answering. Numbered prefixes control order (000, 100, 200, …).
- **`context-priority.md`** – Which docs to load first for database, API, architecture, and features. Use it to avoid scanning the codebase when docs exist.

## Rule files

| File | Purpose |
|------|--------|
| `000-project-overview.mdc` | Project description, tech stack, main modules. Always applied. |
| `100-global-conventions.mdc` | Naming, style, error-handling patterns. Always applied. |
| `200-architecture.mdc` | Layering, module boundaries. Auto-attached for architecture/src. |
| `300-database.mdc` | DB naming, schema rules, migrations. Auto-attached for database/models. |
| `400-api-design.mdc` | API conventions, response format. Auto-attached for routes/controllers/api. |
| `500-security.mdc` | Auth, authorization, data protection. Auto-attached for auth/security. |
| `600-error-handling.mdc` | Error classes, logging. Auto-attached for errors/middleware. |

## How to maintain

1. **Keep rules in sync with the codebase** – When patterns change (e.g. new API style, DB conventions), update the corresponding `.mdc` file.
2. **Use AGENTS.md for docs** – The Documentation Agent (see repo root `AGENTS.md`) initializes and updates docs; run “Initialise or update docs from this project” or “Sync all docs with current code” and it will also refresh Cursor rules from the codebase.
3. **Don’t remove placeholders lightly** – If a section is “Not applicable”, leave a one-line note rather than deleting the section, so future readers know it was considered.

## Front matter in .mdc files

- `description`: Short summary for Cursor.
- `alwaysApply: true`: Rule is always in context (e.g. project overview, conventions).
- `globs`: File patterns so the rule is auto-attached when editing matching paths.
- `autoAttach: true`: Use with globs to attach the rule in those contexts.

Edit these when adding or changing rule files.
