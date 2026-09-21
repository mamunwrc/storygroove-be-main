# Logging standards — storygroove-be

## Current practice

`console.log` / `console.error` in catch blocks and diagnostic paths (e.g. subscription middleware logs `path`).

## Guidance

- Log **errors** with enough context to debug (`userId`, `novelId`, route name) but **never** log JWTs, passwords, Stripe secrets, or full OpenAI payloads in production.
- Prefer **structured** logs if Winston or another logger is adopted later: level, message, structured fields.
- Rate-limit noisy logs inside hot loops (retrieval, per-chunk stream) to avoid disk saturation.

## Correlation

Not applicable today—if introduced, pass a request id from the edge proxy into log metadata.
