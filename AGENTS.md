# AGENTS — Features inventory (any tech stack)

These instructions apply to **this repository**, regardless of language, framework, or layout. When the user asks to **build**, **refresh**, or **update the features list** (or similar), follow this document **unless** they explicitly override it.

---

## Purpose

Maintain a **machine-friendly feature map** under `docs/features/` so humans and automation can:

- See what the product does in **feature-sized** chunks.
- Know which **code paths** belong to each feature (for PR impact, onboarding, and AI updates).

**This workflow only creates or updates files under `docs/features/`** unless the user explicitly asks to change application code or other documentation.

---

## Tech stack neutrality

- Do **not** assume a specific folder layout (`src/`, `app/`, `lib/`, `packages/`, etc.). **Infer** structure from what exists in the repo.
- Use **repository-root-relative paths** only, POSIX-style (`/`). No absolute disk paths.
- Features may map to services, modules, packages, plugins, apps in a monorepo, or logical domains—choose what best matches **this** codebase.

---

## Step 1 — Directory and file layout (required)

1. If `docs/features/` does not exist, **create** it (including parent `docs/` if needed).
2. For each distinct feature, create a folder:
   - `docs/features/<feature-slug>/`
3. Inside each feature folder, create **exactly these two files** (names tied to the slug):
   - `docs/features/<feature-slug>/<feature-slug>.md` — human-readable description.
   - `docs/features/<feature-slug>/<feature-slug>.paths.json` — structured paths for scripts.

**Naming — `<feature-slug>`:**

- Lowercase ASCII.
- Words separated by **hyphens** (e.g. `user-auth`, `billing-webhook`).
- Stable over time (do not rename slugs casually; add a new slug if the feature splits).

---

## `<feature-slug>.md` — Content guidelines

Include, in clear prose (adapt headings as needed):

- **Title** — Same as or derived from `title` in the JSON file.
- **Summary** — What the feature does for users or the system.
- **Scope** — In/out of scope in one short list.
- **Primary responsibilities** — Bullets.
- **Dependencies** — Other features, external systems, env vars (names only, no secrets).
- **How to navigate the code** — Pointers to the most important paths listed in the JSON (directories or files).
- **Open questions / gaps** — Optional; use when the mapping is uncertain.

Do **not** paste secrets, tokens, or private URLs. Do **not** duplicate large API contracts here unless the user asks—prefer pointing at existing docs or code entrypoints.

---

## `<feature-slug>.paths.json` — Required schema

Single JSON object per file. **Valid JSON only** (double quotes, no trailing commas).

| Field | Type | Required | Description |
|--------|------|----------|-------------|
| `schema_version` | string | yes | Use `"1"` until a future migration changes the contract. |
| `feature_id` | string | yes | Must equal `<feature-slug>`. |
| `title` | string | yes | Short human title. |
| `description` | string | no | One-line summary for tools. |
| `source_paths` | array of string | yes | Repo-relative files and/or directories that **primarily implement** this feature. Empty array only if truly unknown—then set `mapping_confidence` to `"low"` and explain in the `.md` file. |
| `related_paths` | array of string | no | Tests, config, CI, infra, or docs that are **strongly tied** to this feature. |
| `entrypoints` | array of string | no | Main entry files (CLI main, server bootstrap, route index, etc.) if identifiable. |
| `mapping_confidence` | string | no | One of: `"high"`, `"medium"`, `"low"`. |

**Path rules:**

- Prefer **directories** when a whole subtree belongs to the feature (easier for prefix matching in PR scripts).
- Prefer **files** when scope is small or shared folders would create false positives.
- Paths must exist in the repo at the time of writing (no speculative paths).

**Example:**

```json
{
  "schema_version": "1",
  "feature_id": "example-feature",
  "title": "Example feature",
  "description": "Illustrates JSON shape only.",
  "source_paths": ["services/example/", "packages/example-core/src/"],
  "related_paths": ["services/example/tests/", "docs/example.md"],
  "entrypoints": ["services/example/cmd/server/main.go"],
  "mapping_confidence": "high"
}
```

---

# Documentation Agent Instructions

You are the Documentation Agent for this project. Your role is to ensure the standard documentation structure exists and is populated based on the actual codebase.

---

## Core Principles

1. **Never rename or duplicate existing folders**
   - If `.cursor` exists → use `.cursor` (do NOT create `.cursor-new`)
   - If `architecture` exists → use `architecture` (do NOT create `architecture-new`)
   - If `docs` exists → use `docs` (do NOT create `docs-new`)

2. **Never delete existing files**
   - All existing files inside folders must be preserved
   - Only add new files and/or update existing files

3. **File handling rules**
   - If a required file does not exist → create it with standard name and template content
   - If a required file already exists with same name → update/extend it (merge, don't replace)
   - If extra files exist that don't conflict → leave them as-is (no renaming, no deletion)

4. **Codebase is source of truth**
   - When docs are missing or incomplete → generate from actual code
   - When docs exist but conflict with code → update docs to match code behavior
   - Preserve valuable existing documentation content when updating

---

## Documentation Reference Guide

**CRITICAL:** When answering questions, always reference documentation files instead of scanning the codebase. This reduces token usage by 80-95% and improves accuracy.

### Database Questions
- **Schema structure** → Read `docs/database/schema/current-schema.md`
- **Tables overview** → Read `docs/database/schema/tables-overview.md`
- **Field definitions** → Read `docs/database/schema/data-dictionary.md`
- **Migration history** → Read `docs/database/migrations/migration-history.md`
- **Naming conventions** → Read `docs/database/rules/naming-conventions.md`
- **Indexing strategy** → Read `docs/database/rules/indexing-strategy.md`

**Never scan Prisma schema, migration files, or model files directly** - use the documentation instead.

### Architecture Questions
- **System design** → Read `architecture/system-architecture.md`
- **Application structure** → Read `architecture/application-architecture.md`
- **Infrastructure** → Read `architecture/infrastructure.md`
- **Data flow** → Read `architecture/data-flow.md`
- **Security architecture** → Read `architecture/security-architecture.md`
- **Architectural decisions** → Read `architecture/ADRs/` (relevant ADRs)

**Never scan src/ folder to understand architecture** - use architecture docs instead.

### API Questions
- **API overview** → Read `docs/api/contracts/api-overview.md`
- **Specific endpoints** → Read `docs/api/endpoints/[module-name]-endpoints.md`
- **API versioning** → Read `docs/api/contracts/versioning-policy.md`
- **Authentication/Authorization** → Read `docs/api/contracts/api-overview.md` (auth section)

**Never scan route/controller files to understand API** - use API docs instead.

### Feature Questions
- **Feature specifications** → Read `docs/features/[feature-name]/specification.md`
- **Feature template** → Read `docs/features/template.md`
- **Implementation notes** → Read `docs/features/[feature-name]/implementation-notes.md`

**Never scan code to understand features** - use feature specs instead.

### Standards Questions
- **Coding style** → Read `docs/standards/coding-style.md`
- **Error handling** → Read `docs/standards/error-handling.md`
- **Logging standards** → Read `docs/standards/logging-standards.md`
- **Naming conventions** → Read `docs/standards/naming-conventions.md`

**Never scan code to understand standards** - use standards docs instead.

### How to Use This Guide
1. **When user asks a question** - Check this guide to find the relevant documentation file
2. **Load that file** - Instead of scanning the codebase
3. **Reference the doc** - Use it as the source of truth
4. **Only scan code if** - Documentation is missing, outdated, or user explicitly asks for code analysis

---

## Standard Documentation Structure

Ensure these folders and files exist (create only if missing, never delete existing):

### `.cursor/` (or use existing)
- `rules/`
  - `000-project-overview.mdc`
  - `100-global-conventions.mdc`
  - `200-architecture.mdc`
  - `300-database.mdc`
  - `400-api-design.mdc`
  - `500-security.mdc`
  - `600-error-handling.mdc`
- `context-priority.md`
- `README.md`

### `architecture/` (or use existing)
- `ADRs/`
  - `0001-template.md`
- `system-architecture.md`
- `application-architecture.md`
- `infrastructure.md`
- `security-architecture.md`
- `data-flow.md`
- `README.md`

### `docs/` (or use existing)
- `database/`
  - `schema/`
    - `current-schema.md`
    - `tables-overview.md`
    - `data-dictionary.md`
  - `migrations/`
    - `migration-policy.md`
    - `migration-history.md`
  - `rules/`
    - `naming-conventions.md`
    - `indexing-strategy.md`
    - `constraints-policy.md`
    - `data-types-standards.md`
  - `README.md`
- `api/`
  - `contracts/`
    - `api-overview.md`
    - `versioning-policy.md`
  - `endpoints/`
    - `[module-name]-endpoints.md` (one per major module)
  - `README.md`
- `features/`
  - `template.md`
  - `[feature-name]/specification.md` (at least one example)
  - `README.md`
- `issues/`
  - `templates/`
    - `bug-report-template.md`
    - `feature-request-template.md`
    - `technical-debt-template.md`
  - `known-issues.md`
  - `resolved-issues.md`
  - `triage-process.md`
  - `README.md`
- `SOPs/`
  - `development/` (onboarding, code-review, testing, git-workflow)
  - `deployment/` (release-process, rollback-procedure)
  - `maintenance/` (updating-docs, etc.)
  - `README.md`
- `standards/`
  - `coding-style.md`
  - `error-handling.md`
  - `logging-standards.md`
  - `naming-conventions.md`
  - `README.md`
- `changelog.md`

---

## Initial Setup Procedure

When the user says: **"Initialise or update docs from this project"** (or uses the full prompt from README-IMPLEMENTATION.md), follow these steps.

### CRITICAL: Complete Fill Requirement

**You MUST write substantive content into every standard file listed below.** No standard file may remain empty or contain only placeholder text (e.g. "[Cursor will populate...]", "[Describe...]", "[Standard ADR template]"). If a file exists but is stub-only, replace/expand it with real content from the codebase. Process every file in the checklist; do not skip any. If the codebase does not have enough information for a section, write "Not applicable" or the best inference with a one-line note—do not leave placeholders.

### Step 1: Ensure Structure Exists
- Check if `.cursor`, `architecture`, `docs` folders exist
- If they exist → use them as-is
- If they don't exist → create them with exact names (no `-new` suffix)
- Create all required subfolders (only if missing)
- Create all required files (only if missing, using standard templates)

### Step 2: Scan Existing Documentation
- Read existing files in:
  - `.cursor/rules/*.mdc`
  - `architecture/*.md`
  - `docs/database/*.md`
  - `docs/api/*.md`
  - `docs/features/*.md`
- If a file exists:
  - Preserve all existing content
  - Update/extend it to match actual codebase
  - Merge standard sections with existing content
  - Do NOT delete or replace existing valuable information

### Step 3: Generate Missing Documentation from Codebase

#### Architecture Documentation
- Read main application entry points (`src/index.ts`, `src/app.ts`, `src/server.ts`, etc.)
- Analyze module structure in `src/modules/` or equivalent
- Identify technology stack (frameworks, libraries, databases)
- Generate/update:
  - `architecture/system-architecture.md` - High-level system design
  - `architecture/application-architecture.md` - Application layer structure
  - `architecture/infrastructure.md` - Deployment and infrastructure
  - `architecture/data-flow.md` - How data flows through the system

#### Database Documentation
- Read ORM schema files (Prisma `schema.prisma`, TypeORM entities, Sequelize models, etc.)
- Read migration files if available
- Generate/update:
  - `docs/database/schema/current-schema.md` - Complete current schema
  - `docs/database/schema/tables-overview.md` - Quick table reference
  - `docs/database/schema/data-dictionary.md` - Field definitions and constraints

#### API Documentation
- Read route files (`src/routes/`, `src/api/`, etc.)
- Read controller files
- Identify all endpoints (method, path, parameters)
- Generate/update:
  - `docs/api/contracts/api-overview.md` - API overview, authentication, response formats
  - `docs/api/endpoints/[module-name]-endpoints.md` - Detailed endpoint documentation per module

#### Feature Documentation
- Identify major features/modules from codebase
- Create at least one example feature spec:
  - `docs/features/[major-feature]/specification.md` (e.g., user-authentication, posts, etc.)
  - Follow the template structure from `docs/features/template.md`

### Step 4: Populate Cursor Rules
- Analyze actual codebase patterns:
  - Naming conventions (variables, functions, classes, files)
  - Architecture patterns (layers, modules, dependencies)
  - Database patterns (naming, migrations, constraints)
  - API patterns (REST, GraphQL, error handling)
- Update/create `.cursor/rules/*.mdc` files:
  - `000-project-overview.mdc` - Project context, tech stack, key modules
  - `100-global-conventions.mdc` - Coding standards observed in codebase
  - `200-architecture.mdc` - Architectural patterns used
  - `300-database.mdc` - Database conventions and rules
  - `400-api-design.mdc` - API design patterns
  - `500-security.mdc` - Security practices
  - `600-error-handling.mdc` - Error handling patterns

### Step 5: Precedence and Conflict Resolution
- **Code is always the source of truth**
- If existing docs conflict with code:
  - Update docs to reflect actual code behavior
  - Preserve useful explanations from existing docs
  - Add notes if something is planned but not yet implemented
- If multiple files exist with similar names:
  - Keep all non-conflicting files
  - Update the one that matches our standard name
  - Leave others untouched

### Step 6: Fill Every Standard File (Checklist)

Before finishing, ensure each of these has **real content** (not stub/placeholder):

**`.cursor/`**
- [ ] `context-priority.md` – Full documentation location map and priority order (see SpecEngine .cursor/context-priority.md for structure)
- [ ] `README.md` – How Cursor rules work and how to maintain them
- [ ] `rules/000-project-overview.mdc` – Project description, tech stack, key modules
- [ ] `rules/100-global-conventions.mdc` – Naming, style, error handling patterns
- [ ] `rules/200-architecture.mdc` – Layering, module boundaries, patterns
- [ ] `rules/300-database.mdc` – DB naming, schema rules, migrations
- [ ] `rules/400-api-design.mdc` – API conventions, response format
- [ ] `rules/500-security.mdc` – Auth, authorization, data protection
- [ ] `rules/600-error-handling.mdc` – Error classes, logging

**`architecture/`**
- [ ] `README.md` – Index of architecture docs
- [ ] `system-architecture.md` – High-level system design from codebase
- [ ] `application-architecture.md` – App layers and module structure
- [ ] `infrastructure.md` – Deployment, environments, infra
- [ ] `security-architecture.md` – Auth flow, authorization
- [ ] `data-flow.md` – How data flows (key flows)
- [ ] `ADRs/0001-template.md` – Full ADR template with all sections (title, status, context, decision, consequences, alternatives)

**`docs/database/`**
- [ ] `README.md` – Index of database docs
- [ ] `schema/current-schema.md` – All tables/columns from schema or migrations
- [ ] `schema/tables-overview.md` – Short table list and purpose
- [ ] `schema/data-dictionary.md` – Field definitions (or "See current-schema" if combined)
- [ ] `migrations/migration-policy.md` – How migrations are named and run
- [ ] `migrations/migration-history.md` – List of migrations (or "None yet" with one line)
- [ ] `rules/naming-conventions.md` – Table/column/index naming
- [ ] `rules/indexing-strategy.md` – When/how to add indexes
- [ ] `rules/constraints-policy.md` – FK, unique, check usage
- [ ] `rules/data-types-standards.md` – Standard types used

**`docs/api/`**
- [ ] `README.md` – Index of API docs
- [ ] `contracts/api-overview.md` – Base URL, auth, response/error format
- [ ] `contracts/versioning-policy.md` – Versioning approach
- [ ] `endpoints/[module]-endpoints.md` – At least one module with all endpoints documented

**`docs/features/`**
- [ ] `README.md` – Index of feature specs
- [ ] `template.md` – Full feature-spec template (all sections)
- [ ] At least one `[feature-name]/specification.md` – Real feature from codebase

**`docs/issues/`**
- [ ] `README.md` – How to use issues/templates
- [ ] `templates/bug-report-template.md` – Full template
- [ ] `templates/feature-request-template.md` – Full template
- [ ] `templates/technical-debt-template.md` – Full template
- [ ] `known-issues.md` – Content or "None currently"
- [ ] `resolved-issues.md` – Content or "None yet"
- [ ] `triage-process.md` – How issues are triaged

**`docs/SOPs/`**
- [ ] `README.md` – Index of SOPs
- [ ] `development/onboarding.md` – Setup and first steps
- [ ] `development/code-review-process.md` – Review checklist/process
- [ ] `development/testing-guidelines.md` – Test types and expectations
- [ ] `development/git-workflow.md` – Branching, commits, PRs
- [ ] `deployment/release-process.md` – Release steps
- [ ] `deployment/rollback-procedure.md` – Rollback steps
- [ ] `maintenance/updating-docs.md` – When and how to update docs

**`docs/standards/`**
- [ ] `README.md` – Index of standards
- [ ] `coding-style.md` – Style rules from codebase
- [ ] `error-handling.md` – Error pattern and format
- [ ] `logging-standards.md` – Log levels and format
- [ ] `naming-conventions.md` – Naming rules

**`docs/changelog.md`**
- [ ] At least a header and one entry or "Initial documentation setup"

### Step 7: Summary
Provide a concise summary:
- Which folders/files were created
- Which existing files were updated
- Which areas need manual review
- Any TODOs or questions left in the documentation

---

## Important Notes

- **Never create `*-new` folders** - always use existing folder names
- **Never delete existing files** - preserve all existing documentation
- **Merge, don't replace** - when updating existing files, merge content intelligently
- **Code over docs** - if code and docs conflict, update docs to match code
- **Preserve valuable content** - keep business context, explanations, and notes from existing docs

---

---

## Ongoing Documentation Updates

### Update Procedure: Full Documentation Sync

When the user says: **"Sync all docs with current code"** or **"Update all documentation"**, follow these steps:

1. **Scan Recent Changes**
   - Check git history for recently modified files (if available)
   - Identify changed areas:
     - New/modified routes/controllers → API changes
     - New/modified database models/migrations → DB changes
     - New/modified modules/services → Architecture changes
     - New features added → Feature docs needed

2. **Update Affected Documentation**
   - **API Changes**: Update `docs/api/contracts/api-overview.md` and relevant `docs/api/endpoints/*.md`
   - **Database Changes**: Update `docs/database/schema/*.md` and append to `migration-history.md`
   - **Architecture Changes**: Update `architecture/*.md` files and create ADR if major change
   - **Feature Changes**: Update or create `docs/features/[feature-name]/specification.md`

3. **Update Cursor Rules** (if patterns changed)
   - If coding patterns changed → update `.cursor/rules/100-global-conventions.mdc`
   - If architecture patterns changed → update `.cursor/rules/200-architecture.mdc`
   - If database patterns changed → update `.cursor/rules/300-database.mdc`
   - If API patterns changed → update `.cursor/rules/400-api-design.mdc`

4. **Preserve Existing Content**
   - Keep valuable explanations and notes
   - Only update factual information (endpoints, schemas, etc.)
   - Add notes if something is deprecated but not yet removed

5. **Summary**
   - List what was updated
   - Note any areas that need manual review
   - Flag any conflicts or questions

### Update Procedure: Specific File

When the user says: **"Update [file-path] documentation"** (e.g., "Update docs/api/endpoints/posts-endpoints.md"), follow these steps:

1. **Identify the File and Section**
   - Determine which section the file belongs to (API, Database, Architecture, Features)
   - Read the current file content to understand what needs updating

2. **Scan Relevant Code**
   - **API files**: Read corresponding route/controller files
   - **Database files**: Read schema/migration files
   - **Architecture files**: Read module structure and entry points
   - **Feature files**: Read feature implementation code

3. **Update Only That File**
   - Preserve existing valuable content (explanations, notes, context)
   - Update factual information to match current codebase
   - Merge new information with existing content intelligently
   - Maintain file structure and formatting

4. **Check Dependencies**
   - If API file updated, check if architecture docs reference it
   - If DB file updated, check if API docs reference the schema
   - Update cross-references if needed

5. **Summary**
   - Confirm what was updated in the file
   - Note any related files that might need updates
   - Flag any questions or conflicts

### Update Procedure: After Feature Completion

When the user says: **"Document the [feature-name] feature"** or **"Update docs for recent feature"**, follow these steps:

1. **Identify the Feature**
   - Look for new modules/routes related to the feature
   - Check git commits or recent changes (if available)
   - Ask user to clarify if unclear

2. **Create/Update Feature Spec**
   - Create `docs/features/[feature-name]/specification.md`
   - Document:
     - What the feature does
     - API endpoints (if any)
     - Database changes (if any)
     - Dependencies
     - Testing approach

3. **Update Related Docs**
   - Add endpoints to `docs/api/endpoints/[module]-endpoints.md`
   - Update database schema docs if tables changed
   - Update architecture if structure changed
   - Add to changelog

4. **Update Cursor Rules** (if feature introduces new patterns)
   - Add patterns to relevant `.cursor/rules/*.mdc` files

### Safety Rules for Updates

- **Never delete** existing documentation unless explicitly asked
- **Always preserve** valuable explanations and context
- **Merge intelligently** - combine old and new information
- **Flag conflicts** - if code and docs conflict, note it
- **Ask for clarification** if something is unclear

### Update Frequency Recommendations

- **After major features**: Run full sync
- **After API changes**: Update API docs
- **After DB changes**: Update DB docs
- **Weekly/Monthly**: Run full sync to catch everything
- **Before releases**: Always run full sync

---

## Usage

### Initial Setup
The user will:
1. Run `node init-docs-structure.js` once to create folder structure
2. Then ask you: **"Initialise or update docs from this project"**
3. You follow the procedure above to populate documentation from the codebase

### Ongoing Updates
The user can:
1. Run `node init-docs-structure.js --update-all` to prepare for full update
2. Then ask you: **"Sync all docs with current code"**
3. Or run `node init-docs-structure.js --update-file <path>` for specific file
4. Then ask you: **"Update [file-path] documentation"**
