# 7. Subscription lifecycle

Writer view: `storygroove-fe/docs/user-guide/07-managing-your-subscription.md`.

All JSON routes below use `authenticateUserWithoutOpenAI` except the public checkout documented in chapter 1.

## Endpoints

| Writer action | API |
|---|---|
| New Builder/Studio (logged in) | `POST /api/stripe/create` |
| Upgrade (immediate, `proration_behavior: always_invoice`) | `POST /api/stripe/upgrade` |
| Downgrade (`proration_behavior: none`) | `POST /api/stripe/downgrade` |
| Cancel at period end | `DELETE /api/stripe/cancel` |
| Pause → `PAUSE_SUBSCRIPTION_PRICE` | `POST /api/stripe/pause` |
| Resume previous Builder/Studio price | `POST /api/stripe/resume` |
| Current sub | `GET /api/stripe/get`, `GET /api/stripe/v2/get` |
| Agent flags | `GET /api/stripe/v2/agent-access` |
| Simone $7 Checkout | `POST /api/stripe/simone/one-time-checkout` |
| Card on file | `GET /api/stripe/payment-method` |
| New card (Stripe Elements) | `POST /api/stripe/payment-method/setup-intent` then `POST /api/stripe/payment-method` |
| Billing portal (legacy FE only) | `POST /api/stripe/create-portal-session` |
| Plan catalog | `GET /api/subscription/v2/list` (no JWT) |

`GET /api/stripe/get-price-list` **is authenticated** in `stripeRoute.js`. Older endpoint docs that mark it public are wrong.

## Pause implementation

`stripeService.pauseSubscriptionToPausePlan`:

- Swap subscription item to `PAUSE_SUBSCRIPTION_PRICE`
- Store prior price on Stripe metadata `pre_pause_price_id` and `User.pausedFromPriceId`

Resume reads that stored price. If it is missing, resume fails until support sets the price in Stripe.

Pause is **not** Stripe `pause_collection` in the current product path (though `isSubscribedUser` still treats `pause_collection` as paused if it appears).

**Note (Sep 2026):** writer-facing pause copy is **three months** per calendar year, and **private community access is on hold** while paused (sidebar Community link stays visible but disabled). Earlier FE copy said six months and that community stayed open. Quote the FE Subscription tab, not older docs.

## Membership

`requiresMembershipFee(stripeCustomerId)` is true when `MEMBERSHIP_PRICE` is set, the customer never held Builder/Studio (including legacy IDs), and never paid the membership price. Added on public Checkout, in-app `create`, and admin invite Checkout.

## Payment method

SetupIntent + `confirmCardSetup` in the browser (`STRIPE_PUBLISHABLE_KEY`). Server attaches the new PM as default and detaches old cards. Never log PANs.

## Invoices / failed payment

`invoice.payment_failed` is handled in code (`processInvoice`) but only if Stripe sends it. There is no writer-facing failed-renewal banner. Support: Stripe Dashboard → invoice → customer email → User `stripeCustomerId`.

## Related

- `routers/stripeRoute.js`, `subscriptionRoute.js`
- `service/stripeService.js`, `stripeWebhooksService.js`
- `docs/api/endpoints/stripe-subscription-endpoints.md`
- `docs/SOPs/deployment/stripe-payment-links.md` (webhook event names there may lag the code)

Next: [Diagnosing stuck users](08-diagnosing-stuck-users.md)
