# Triage process — storygroove-be

1. **Verify** — reproduce with curl/Postman against a dev stack; capture status code and JSON body.
2. **Classify** — auth (`401/403`), Stripe webhook, OpenAI dependency, Mongo query, or client contract mismatch.
3. **Severity** — Sev1 (billing or total outage), Sev2 (major feature down), Sev3 (edge case), Sev4 (cosmetic/docs).
4. **Route** — assign to owner familiar with the router (`novel`, `chat`, `stripe`, `admin`).
5. **Document** — update `known-issues.md` if users are impacted before a fix lands.

This repository does not mandate a specific GitHub label set; align labels with the monorepo if issues live in a shared project.
