# Stripe Checkout Sessions — checkout-first signup

Use this SOP when configuring the external landing page to create **Stripe Checkout Sessions on demand** through the backend public API.

## Overview

1. Customer clicks a plan on the landing page.
2. Landing page calls `POST /api/stripe/public/checkout-session`.
3. Backend creates or reuses a Stripe customer, then creates the Checkout Session.
4. Stripe sends `checkout.session.completed` to `POST /webhook`.
5. Backend provisions (or links) a User, sends a verification email.
6. Stripe redirects to `{CLIENT_URL}/checkout-success`.
7. Customer verifies email → sets password → logs in.

## Prerequisites

- Webhook endpoint `POST /webhook` is live in production with `STRIPE_WEBHOOK_SECRET` configured.
- `CLIENT_URL` points at the Story Groove frontend (e.g. `https://app.storygroove.com`).
- Landing-page CORS: set `PUBLIC_CHECKOUT_ORIGINS` for fixed marketing domains, or rely on the built-in `.lovableproject.com` suffix for Lovable previews. Optional `PUBLIC_CHECKOUT_ORIGIN_SUFFIXES` adds more suffixes.
- Env price IDs match Stripe products (see `.env` / deployment config).

## Package mapping (4 landing packages)

| Package | Stripe mode | Line items | Notes |
|---------|-------------|------------|--------|
| Simone (one-time) | `payment` | `SIMONE_ONETIME_PRICE` | Credits applied on `checkout.session.completed` |
| Builder monthly | `subscription` | Builder monthly price + optional `MEMBERSHIP_PRICE` | Membership auto-added for first-time buyers |
| Builder yearly | `subscription` | Builder yearly price + optional `MEMBERSHIP_PRICE` | Same |
| Studio monthly | `subscription` | Studio monthly price + optional `MEMBERSHIP_PRICE` | Same |
| Studio yearly | `subscription` | Studio yearly price + optional `MEMBERSHIP_PRICE` | Same |

### Reference price env vars (test/staging examples)

| Variable | Purpose |
|----------|---------|
| `SIMONE_ONETIME_PRICE` | Simone one-time purchase |
| `PRICE_BUILDER_MONTHLY` / `PRICE_BUILDER_YEARLY` | Builder subscription |
| `PRICE_STUDIO_MONTHLY` / `PRICE_STUDIO_YEARLY` | Studio subscription |
| `MEMBERSHIP_PRICE` | One-time membership line item on Builder/Studio links |

## Public API contract

### Endpoint

`POST /api/stripe/public/checkout-session`

### Required body

```json
{
  "priceId": "price_..."
}
```

Stripe Checkout collects the customer's email and payment method. No name or email is required from the landing page.

### Optional body

- `successUrl` (defaults to `{CLIENT_URL}/checkout-success`)
- `cancelUrl` (defaults to `CANCEL_URL`, else `CLIENT_URL`)

### Response

Returns:

```json
{
  "url": "https://checkout.stripe.com/...",
  "sessionId": "cs_...",
  "expiresAt": 1234567890,
  "includeMembership": true,
  "requiresMembershipFee": true,
  "mode": "subscription"
}
```

The landing page should redirect the browser to `url`.

## Customer resolution

- No app user or Stripe customer is created before checkout.
- Stripe creates the customer when the payer completes Checkout (`customer_creation: 'always'` on one-time payment sessions; subscription sessions create a customer automatically).
- After payment, `checkout.session.completed` provisions (or links) the Story Groove user from the email on the session.
- Builder/Studio sessions include `MEMBERSHIP_PRICE` when there is no known Stripe customer yet (typical landing-page signup).
- Returning subscribers who need membership exemption should use in-app authenticated checkout instead.

## Webhook events

Ensure the webhook listens for at least:

- `checkout.session.completed` — user provisioning + Simone credits
- `customer.subscription.created` / `customer.subscription.updated` — Subscriber sync
- `invoice.paid` / `invoice.payment_failed` — billing state (existing handlers)

Provisioning runs when `payment_status === 'paid'`. Subscription webhooks fall back to customer-based provisioning if the user row is not found yet.

## Post-payment user experience

| Step | Where |
|------|--------|
| Payment success | `/checkout-success` — instructs verify email → set password → login |
| Email verify | `/verify/:token` → redirects to `/passwordReset/:token/:id` for checkout users |
| Password set | `/passwordReset/:token/:id` → `/login` |
| Login blocked until password set | API returns `PASSWORD_SETUP_REQUIRED` if verify was skipped |

Legacy in-app `/signup` + subscription tab remains for register-first users.

## Testing (Stripe CLI)

```bash
stripe listen --forward-to localhost:8086/webhook
```

1. Call the public checkout API from the landing page or a test client.
2. Confirm User row: `signupType: stripe_checkout`, `passwordSetupRequired: true`, `stripeCustomerId` set.
3. Confirm verification email sent.
4. `customer.subscription.created` creates Subscriber (no “user not found” in logs).
5. Verify link → password reset page (not dashboard).
6. After password reset → login succeeds.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Payment succeeded, no user | Webhook delivery logs; provisioning error in server logs |
| Subscription webhook “cannot find user” | Should self-heal via customer provisioning fallback; verify email on Stripe customer |
| User lands on dashboard after verify | User must be `stripe_checkout` or `passwordSetupRequired`; clear stale JWT in browser |
| CORS failure from landing page | Add the landing origin to `PUBLIC_CHECKOUT_ORIGINS` |
| Simone credits missing | `SIMONE_ONETIME_PRICE` matches requested `priceId`; session `mode: payment` |
