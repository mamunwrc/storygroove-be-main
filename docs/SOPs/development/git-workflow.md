# Git workflow — storygroove-be

## Branches

Use feature branches off the team’s main integration branch (commonly `main` or `develop`). Name branches with a short prefix: `feature/`, `fix/`, `chore/`.

## Commits

Write imperative subject lines (`Add rate limit to cover generation`). Keep unrelated refactors in separate commits when practical.

## Pull requests

- Describe API changes and link to `docs/api` updates.
- Call out env var additions for deployment teams.
- Attach Postman/curl examples for new routes when helpful.

## Releases

Tag or deploy per your platform; this repo does not enforce a single release tool. Document human steps in `docs/SOPs/deployment/release-process.md`.
