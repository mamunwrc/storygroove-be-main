# Manual Invite Checkout (Superadmin)

## Summary

Superadmin-only flow for inviting a specific customer to a subscription. The superadmin selects a user and a Builder/Studio price; the backend creates a Stripe Checkout Session on behalf of that user (creating a Stripe customer first if needed) and returns the URL. A second endpoint emails that URL to the user via the standard transactional mail pipeline.

## Scope

- In scope: superadmin-gated endpoints to create a checkout link for any non-superadmin user, and to email that link via the standard `sendEmail` pipeline.
- Out of scope: actually billing the user — Stripe Checkout handles payment; the existing webhook (`stripe-webhooks`) syncs the resulting subscription. One-time Simone prices are intentionally **not** offered through this flow.

## Primary responsibilities

- Validate the requested `priceId` against the current Builder/Studio plan list (`PRICE_BUILDER_*` / `PRICE_STUDIO_*`); reject anything else, including Simone one-time prices.
- Load the target user; refuse if they are a superadmin (no peer invites).
- Resolve or create the user's Stripe customer via `StripeService.createCustomer`.
- Create a subscription-mode Checkout Session with `StripeService.createCheckout` and return the URL + session id.
- Email the URL to the user using `inviteCheckout.handlebars`, branded as coming from the inviter.
- Write activity log entries on both link generation and email send.

## Dependencies

- Feature: `stripe-subscription-billing` (`createCheckout` is reused).
- Feature: `subscription-access-control` (existing post-checkout enforcement still applies via Stripe webhooks).
- Feature: `jwt-auth-middleware` (`requireSuperAdmin`).
- Feature: `email-delivery` (Nodemailer + Handlebars).
- Feature: `activity-logging`.
- Env: `PRICE_BUILDER_MONTHLY`, `PRICE_BUILDER_YEARLY`, `PRICE_STUDIO_MONTHLY`, `PRICE_STUDIO_YEARLY`, `STRIPE_SECRET_KEY`, `DASHBOARD_URL`, `CANCEL_URL`, `NODE_MAILER_USER`, SMTP envs.

## How to navigate the code

- `controllers/stripeController.js` — `createManualInviteCheckout` and `sendManualInviteCheckoutEmail` handlers plus the `getAllowedManualInvitePriceIds` allow-list helper.
- `routers/stripeRoute.js` — `/api/stripe/admin/invite-checkout` and `/api/stripe/admin/invite-checkout/email` (both `authenticateUserWithoutOpenAI` + `requireSuperAdmin`).
- `service/stripeService.js` — reuses `createCustomer` + `createCheckout`.
- `utils/template/inviteCheckout.handlebars` — email body.
- `utils/mailGun.js` — transport used by `sendEmail`.

## Open questions / gaps

- The user-side success URL is the standard `DASHBOARD_URL`. If we ever want a dedicated "welcome, please log in" landing page after a manual invite, we'd thread it through the Checkout `success_url` parameter.
- Stripe Checkout sessions expire after ~24 hours; if an invite is ignored for longer, the admin needs to generate a new link. The UI currently notes this; we could shorten or extend via `expires_at` if needed.
