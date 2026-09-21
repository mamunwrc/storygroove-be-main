# 1. Checkout and provisioning

Writer view: `storygroove-fe/docs/user-guide/01-getting-started.md`. Match this repo to `service/checkoutProvisioningService.js` and `controllers/stripeController.js`.

## Public Checkout (anonymous)

`POST /api/stripe/public/checkout-session` — no JWT.

Body: `{ priceId, successUrl?, cancelUrl? }`.

Allowed `priceId` values (env):

- `SIMONE_ONETIME_PRICE` → Stripe `mode: "payment"`
- `PRICE_BUILDER_MONTHLY`, `PRICE_BUILDER_YEARLY`, `PRICE_STUDIO_MONTHLY`, `PRICE_STUDIO_YEARLY` → `mode: "subscription"`

Redirect URLs must match `PUBLIC_CHECKOUT_ORIGINS` (CSV) and optional `PUBLIC_CHECKOUT_ORIGIN_SUFFIXES`. Default success URL: `{CLIENT_URL}/checkout-success`. Cancel URL from request or `CANCEL_URL`.

For Builder/Studio, `requiresMembershipFee(null)` may add `MEMBERSHIP_PRICE` as a second line item (first-time member, no Stripe customer yet).

Marketing site: `storygroove-creative-flow` `src/services/checkout-service.ts`.

Logged-in Checkout (already has an account): `POST /api/stripe/create`, `POST /api/stripe/simone/one-time-checkout`. Success for those flows can use `DASHBOARD_URL`. Superadmin invite: `POST /api/stripe/admin/invite-checkout` and `.../email`.

## Webhook

`POST /webhook` on the app root (raw body). Signature: `STRIPE_WEBHOOK_SECRET`.

**Provisioning event:** `checkout.session.completed` when `payment_status === "paid"`.

Handler:

1. `provisionUserFromCheckoutSession(session)`
2. If the session contains `SIMONE_ONETIME_PRICE`, `$inc` `simonePaymentsCount` and `simoneCreditsRemaining`, `$set` `simoneOneTimePaid`

Idempotency: `CheckoutProvision` keyed by Stripe `session.id`. A second delivery of the same session returns the existing user and does **not** send another verification email.

Other event types are implemented in `stripeWebhook` (`invoice.payment_succeeded`, `customer.subscription.*`, prices, products, schedules). If the Stripe endpoint only sends `checkout.session.completed`, those handlers never run. Access checks still use the **Stripe API**, so gating can work without Mongo subscriber sync.

## User record created

`provisionUserForStripeCustomer`:

| Field | New checkout user |
|---|---|
| `status` | `inactive` |
| `signupType` | `stripe_checkout` |
| `passwordSetupRequired` | `true` |
| `password` | random 32-byte hex (bcrypt hashed) |
| `email` / `username` | Stripe email, lowercased |
| `stripeCustomerId` | session customer |

Existing user matched by `stripeCustomerId` or email: Stripe customer linked; if not `active`, `passwordSetupRequired` set true and a verification email sent **only if** there is no unexpired `verificationToken`.

Initial verification token TTL: **48 hours** (`VERIFICATION_TTL_MS`). Email: subject `Verify your email address.` From `StoryGroove Support Team <NODE_MAILER_USER>`. Link: `{CLIENT_URL}/verify/{token}`.

## Skip / failure modes

| Result | Meaning |
|---|---|
| `skipped: not_paid` | Session not paid; no user |
| Missing email on session and customer | Throws; webhook logs `checkout.session.completed provisioning failed` |
| Duplicate key 11000 on email | Concurrent webhook; reuse existing user, no second email |

Failed Checkout (user never submitted) never hits this webhook. FE shows `/subscriptionfailed`.

## Related code

- `routers/stripeRoute.js`
- `controllers/stripeController.js` (`createPublicCheckoutSession`, `stripeWebhook`)
- `service/checkoutProvisioningService.js`
- `models/checkoutProvisionModel.js`, `models/user.js`
- API table: `docs/api/endpoints/stripe-subscription-endpoints.md`

Next: [Account activation](02-account-activation.md)
