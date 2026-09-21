# Testing guidelines — storygroove-be

## Unit tests

- Location: `__tests__/` (`*.test.mjs` or similar).
- Run with **`npm test`** if defined in `package.json`, or invoke the test runner specified there.
- Prefer testing **pure helpers** (outline layout, methodology bundling, token budgets) without live Mongo or OpenAI when possible.

## Integration / manual

- Exercise critical routes with a real JWT and dev Mongo: login → create novel → chat thread.
- Stripe: use Stripe test mode and CLI webhook forwarding for **`POST /webhook`**.
- S3: verify **`GET /userData/*`** returns expected `Content-Type` and 404 for missing keys.

## OpenAI

Do not run load tests against production keys. Mock or stub `responsesApiService` in unit layers when adding coverage.

## Definition of done

New subscription or auth behavior includes a manual test note in the PR. Schema changes mention any backfill script requirement.
