# ADR-0002: Stripe webhook requires raw body before express.json()

## Title

Mount Stripe webhook with `express.raw` before the global JSON parser

## Status

Accepted

## Context

Stripe webhook signature verification compares the signing secret against the **exact raw request bytes**. If `express.json()` consumes the stream first, the reconstructed body may not match Stripe’s payload, causing signature verification failures and missed subscription updates.

## Decision

Register **`POST /webhook`** at the top of `index.js` with **`express.raw({ type: 'application/json' })`** and the Stripe webhook handler. Apply **`express.json({ limit: '10mb' })`** afterward for all other routes.

## Consequences

**Positive**

- Reliable webhook processing and subscriber state updates.
- Clear separation between raw webhook traffic and JSON APIs.

**Negative**

- Developers must remember that **`/webhook` is special** — do not reuse the raw middleware globally.
- Testing webhooks locally requires tunneling or Stripe CLI with the correct secret.

**Neutral**

- Other routes keep comfortable JSON size limits independent of webhook handling.

## Alternatives considered

1. **Verify using parsed JSON**: Rejected — breaks HMAC verification guarantees.
2. **Separate standalone service for webhooks**: Rejected for this codebase size — acceptable as a future extraction if scaling demands it.

---

Use **`0001-template.md`** when authoring new records; pick the next numeric prefix and short slug (`0003-...`, etc.).
