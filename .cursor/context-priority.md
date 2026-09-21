# Context Priority for AI

This document defines which documentation files Cursor AI should prioritize when answering questions. Use these paths instead of scanning the codebase to reduce token usage and improve accuracy.

## Priority order (load first when relevant)

1. **Project & conventions**  
   - `.cursor/rules/000-project-overview.mdc` – project, tech stack, key modules  
   - `.cursor/rules/100-global-conventions.mdc` – naming, style, error handling

2. **Architecture**  
   - `architecture/system-architecture.md` – high-level system design  
   - `architecture/application-architecture.md` – app layers and modules  
   - `architecture/data-flow.md` – key data flows  
   - `architecture/security-architecture.md` – auth and authorization  
   - `architecture/infrastructure.md` – deployment and environments  
   - `architecture/ADRs/` – architectural decisions  
   - `architecture/staged-ai-architecture.md` – proposed staged Story Runtime (cost/scale)

3. **Database**  
   - `docs/database/schema/current-schema.md` – full schema  
   - `docs/database/schema/tables-overview.md` – table list and purpose  
   - `docs/database/schema/data-dictionary.md` – field definitions  
   - `docs/database/migrations/migration-history.md` – migration list  
   - `docs/database/rules/naming-conventions.md`, `indexing-strategy.md`, `constraints-policy.md`, `data-types-standards.md`

4. **API**  
   - `docs/api/contracts/api-overview.md` – base URL, auth, response/error format  
   - `docs/api/contracts/versioning-policy.md` – versioning approach  
   - `docs/api/endpoints/novel-endpoints.md`, `user-endpoints.md`, `chat-endpoints.md`, etc.

5. **Features**  
   - `docs/features/template.md` – feature spec template  
   - `docs/features/[feature-name]/specification.md` – per-feature specs

5b. **User journey**  
   - `docs/user-guide/` – operator walkthrough (checkout → activation → coaches → billing)  
   - Writer copy lives in the frontend repo `docs/user-guide/`

6. **Standards**  
   - `docs/standards/coding-style.md`, `error-handling.md`, `logging-standards.md`, `naming-conventions.md`

7. **Issues & SOPs**  
   - `docs/issues/` – templates, known/resolved issues, triage  
   - `docs/SOPs/` – development, deployment, maintenance

## When to use

- **Database questions** → Read `docs/database/schema/` and `docs/database/rules/` (do not scan Prisma/schema files).  
- **Architecture questions** → Read `architecture/*.md` (do not scan `src/` for structure).  
- **API questions** → Read `docs/api/contracts/` and `docs/api/endpoints/*.md` (do not scan routes/controllers).  
- **Feature questions** → Read `docs/features/[feature-name]/specification.md`.  
- **Writer journey / support** → Read `docs/user-guide/` (operator). Button labels: frontend `docs/user-guide/`.  
- **Standards questions** → Read `docs/standards/*.md`.

Only scan the codebase when documentation is missing, outdated, or the user explicitly asks for code-level analysis.
