# Code review process — storygroove-be

## Goals

Keep the API safe (auth, ownership, billing), prevent Mongo regressions, and preserve OpenAI cost controls.

## Author checklist

- [ ] Routers keep middleware order explicit (auth before subscription before handler).
- [ ] New AI routes call **`checkRateLimit`** when expensive.
- [ ] Queries scope by **`req.user._id`** (unless superadmin tooling with justification).
- [ ] `.env` / secrets not added to git.
- [ ] User-visible behavior reflected in `docs/api/endpoints/*.md` when routes change.

## Reviewer focus

1. **Security** — JWT handling, webhook raw body untouched, no IDOR.
2. **Data** — schema defaults, index needs, soft-delete compatibility.
3. **Ops** — logging noise, missing try/catch on async handlers, Stripe edge cases.
4. **Tests** — extend `__tests__/` when business logic is non-trivial.

## Merge criteria

CI (if configured) green; at least one reviewer familiar with the touched domain (novel vs chat vs billing).
