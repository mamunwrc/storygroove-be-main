# Story Groove — Operator user guide (API)

This is the **system-side** companion to the writer guide in `storygroove-fe/docs/user-guide/`. Use it when a writer is stuck: which account state they are in, which endpoint must have succeeded, which email we sent, and which entitlement check is blocking them.

The writer-facing walkthrough (button labels, screens) is canonical in the frontend repo. Do not duplicate those screenshots in prose here. Link to the matching FE chapter instead.

## Surfaces

| Surface | Repo | Role in this journey |
|---|---|---|
| Marketing site | `storygroove-creative-flow` | `POST /api/stripe/public/checkout-session` |
| App | `storygroove-fe` | Verify, login, coaches, Subscription tab |
| API (this repo) | `storygroove-be` | Provisioning, auth, entitlements, AI, Stripe |

Registration in production is **checkout-first**. `POST /api/user/register` still exists but the marketing site does not offer a signup form.

## Read in order

1. [Checkout and provisioning](01-checkout-and-provisioning.md) — public Checkout, webhook, User create.
2. [Account activation](02-account-activation.md) — verify, password setup, login gates, emails.
3. [Entitlements](03-entitlements.md) — Builder / Studio / Simone credits / pause / cancel.
4. [Simone](04-simone.md) — thread create, credits, session pause.
5. [Olivia](05-olivia.md) — Story Bible thread, `create-from-olivia`.
6. [Ellis](06-ellis.md) — manuscript upload and reviews.
7. [Subscription lifecycle](07-subscription-lifecycle.md) — upgrade, downgrade, pause, resume, cancel, cards.
8. [Diagnosing stuck users](08-diagnosing-stuck-users.md) — checklist mapped to writer symptoms.

Writer chapters: `storygroove-fe/docs/user-guide/01-getting-started.md` through `08-troubleshooting.md`.

## Journey (system)

```
Landing  →  POST /api/stripe/public/checkout-session
         →  Stripe Checkout
         →  POST /webhook  checkout.session.completed
         →  User (inactive, passwordSetupRequired)
         →  verification email
         →  GET /api/user/verify/:token  →  PATCH /api/user/resetPassword
         →  POST /api/user/login
         →  GET /api/stripe/v2/agent-access
         →  Simone / Olivia / Ellis routes gated by isSubscribedUser
```

Entitlements are decided from **live Stripe subscriptions** plus User Simone credit fields. Mongo `Subscriber` / `Subscription` documents are **not** the access source of truth for the current product. Stripe Dashboard may only deliver `checkout.session.completed`; other webhook handlers still exist in code for events that are not currently subscribed.

## Env names (no values)

See each chapter. Never commit secrets. Common: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY`, `CLIENT_URL`, `NODE_MAILER_USER`, price IDs (`PRICE_BUILDER_*`, `PRICE_STUDIO_*`, `SIMONE_ONETIME_PRICE`, `MEMBERSHIP_PRICE`, `PAUSE_SUBSCRIPTION_PRICE`).
