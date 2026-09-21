# Subscriptions and Billing

## Summary

Writers subscribe via Stripe (checkout, upgrade, downgrade, cancel), access billing portal, and receive agent access based on plan. Stripe webhooks sync what Stripe sends; entitlements read live Stripe subscriptions.

## Scope

**In scope:** Stripe checkout, subscription CRUD, billing portal, price list, Simone one-time checkout, webhook handling, subscription plan listing, agent access checks.

**Out of scope:** API usage limits (api-usage-admin). Novel AI gating uses live Stripe via `isSubscribedUser`, not Mongo Subscriber rows.

## Primary responsibilities

- Create and manage Stripe customers and subscriptions.
- Process Stripe webhooks for payment and subscription events.
- Provision users from Payment Link checkouts (`checkout.session.completed`).
- Expose subscription status and agent access to frontend.
- Gate AI features via `isSubscribedUser` middleware (active Builder/Studio or Simone credits). There is no 7-day trial in the current gate.

## Checkout-first signup (Checkout Sessions API)

External landing pages call `POST /api/stripe/public/checkout-session` when a visitor clicks a plan. On paid checkout:

1. `checkoutProvisioningService.provisionUserFromCheckoutSession` creates/links a User (`signupType: stripe_checkout`, `passwordSetupRequired: true`).
2. Verification email is sent; success redirect defaults to `{CLIENT_URL}/checkout-success`.
3. After verify, user sets password (no free-plan registration).

The public endpoint accepts a whitelisted `priceId` only. Stripe collects email and payment details during Checkout; the webhook provisions the app user after payment. Membership is included automatically on Builder/Studio for first-time buyers (no known Stripe customer yet).

Ops setup: see `docs/SOPs/deployment/stripe-payment-links.md`.

## Dependencies

- Stripe API keys, webhook secret.
- Subscriber, Subscription, Invoice models.
- stripeService, stripeWebhooksService.

## How to navigate the code

- Routes: `routers/stripeRoute.js`, `subscriptionRoute.js`, webhook at `POST /webhook`
- Controllers: `stripeController.js`, `subscriptionController.js`
- Services: `stripeService.js`, `stripeWebhooksService.js`, `checkoutProvisioningService.js`
- Models: `subscriberModel.js`, `subscriptionModel.js`, `invoicesModel.js`, `checkoutProvisionModel.js`
- Middleware: `isSubscribedUser` in `tokenverify.js`

## Open questions / gaps

- Landing-page origin must be included in `PUBLIC_CHECKOUT_ORIGINS` if the browser calls the public checkout API directly.

Operator walkthrough of the same journey: [`docs/user-guide/`](../../user-guide/README.md).
