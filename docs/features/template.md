# Feature specification template — storygroove-be

Copy this file to **`docs/features/<feature-slug>/specification.md`** when the **`<slug>.md` + `.paths.json`** inventory pair is not enough depth.

Instructions: delete this introductory section after copying, keep the headings below, and replace prose with real content.

## Feature name

Write a concise product-facing title.

## Summary

Two or three sentences: who benefits and what shipped in this codebase.

## User stories / goals

Add bullet verbs grounded in observable behavior exposed by routers or scripts.

## Requirements

### Functional

List observable behaviors backed by controllers/services.

### Non-functional

Latency, throughput, resilience, RBAC constraints, rollout flags.

## API endpoints

| Method | Path (under `/api/...`) | Purpose |
|--------|--------------------------|---------|

If unused, replace the table row with **Not applicable** and one line explaining why.

## Database / schema

List Mongoose models or fields touched (`models/*.js`). If none, respond **Not applicable** with one clarifying sentence.

## Dependencies

External providers (OpenAI, Stripe, S3), env var **names only**, other modules in this repo.

## Testing approach

Point to **`__tests__/`** suites, curl recipes, Stripe CLI webhook tests, etc.

## Implementation notes

Risky areas, feature flags, follow-up chores.

## Changelog

- YYYY-MM-DD — Initial authored spec.
