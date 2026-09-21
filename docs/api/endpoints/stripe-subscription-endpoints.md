# Stripe & subscription endpoints

## `/api/stripe` (`routers/stripeRoute.js`)

All listed routes use **`authenticateUserWithoutOpenAI`** except:

- `POST /api/stripe/public/checkout-session` (no JWT)
- Superadmin invite routes also require **`requireSuperAdmin`**

| Method | Path | Handler |
|--------|------|---------|
| POST | `/api/stripe/create` | `createNewSubscriber` |
| POST | `/api/stripe/upgrade` | `upgradeSubscription` |
| POST | `/api/stripe/downgrade` | `downgradeSubscription` |
| DELETE | `/api/stripe/cancel` | `cancelSubscription` |
| POST | `/api/stripe/pause` | `pauseSubscription` |
| POST | `/api/stripe/resume` | `resumeSubscription` |
| GET | `/api/stripe/get` | `getSubscription` |
| GET | `/api/stripe/get-price-list` | `getPriceListFromStripe` (JWT required) |
| GET | `/api/stripe/v2/get` | `getSubscriptionV2` |
| GET | `/api/stripe/v2/agent-access` | `getAgentAccess` |
| POST | `/api/stripe/simone/one-time-checkout` | `createSimoneOneTimeCheckout` |
| POST | `/api/stripe/create-portal-session` | `createBillingPortalSession` |
| GET | `/api/stripe/payment-method` | `getPaymentMethod` (safe brand/last4/expiry from Stripe only) |
| POST | `/api/stripe/payment-method/setup-intent` | `createPaymentMethodSetupIntent` |
| POST | `/api/stripe/payment-method` | `replacePaymentMethod` (sets new default card; detaches old cards) |
| POST | `/api/stripe/public/checkout-session` | `createPublicCheckoutSession` (anonymous marketing Checkout) |
| POST | `/api/stripe/admin/invite-checkout` | `createManualInviteCheckout` |
| POST | `/api/stripe/admin/invite-checkout/email` | `sendManualInviteCheckoutEmail` |

Requires env **`STRIPE_PUBLISHABLE_KEY`** for in-app card updates (returned to the browser for Stripe Elements; never store PANs).

Writer and operator walkthroughs: `docs/user-guide/` (this repo) and `storygroove-fe/docs/user-guide/`.

**Webhook**: `POST /webhook` (root, not under `/api`) — raw body — `stripeController.stripeWebhook`. Provisioning for new accounts is `checkout.session.completed`. See `docs/user-guide/01-checkout-and-provisioning.md`.

## `/api/subscription` (`routers/subscriptionRoute.js`)

Public plan catalog (**no JWT** on these routes):

| Method | Path | Handler |
|--------|------|---------|
| GET | `/api/subscription/list` | `subscriptionsList` |
| GET | `/api/subscription/v2/list` | `subscriptionsListV2` |
