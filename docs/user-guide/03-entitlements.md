# 3. Entitlements

Writer view: dashboard tour + subscription chapter. Code: `config/tokenverify.js` (`isSubscribedUser`), `GET /api/stripe/v2/agent-access`.

## Source of truth

**Live Stripe subscriptions** for the user's `stripeCustomerId`, plus User fields `simoneCreditsRemaining` / `simoneOneTimePaid`.

Do not gate writers on Mongo `Subscriber.subscription_status`. Those models may be stale if Stripe is not sending subscription webhooks.

Admins and superadmins skip `isSubscribedUser`.

## Price IDs (env)

| Env | Grants |
|---|---|
| `PRICE_BUILDER_MONTHLY`, `PRICE_BUILDER_YEARLY`, `PRICE_BUILDER_LEGACY_IDS` (CSV) | Simone + Olivia (`plan: "builder"`) |
| `PRICE_STUDIO_MONTHLY`, `PRICE_STUDIO_YEARLY` | Simone + Olivia + Ellis (`plan: "studio"`) |
| `SIMONE_ONETIME_PRICE` | Does not create a subscription. Webhook adds **one** `simoneCreditsRemaining` |
| `PAUSE_SUBSCRIPTION_PRICE` | Stripe sub stays `active` but is treated as **paused** (no coaching) |
| `MEMBERSHIP_PRICE` | One-time; not an agent grant |

`hasPaidAccess` is true only when an active/trialing item's price is in the Builder or Studio lists. Pause price is excluded.

There is **no 7-day trial** in `isSubscribedUser`. Feature doc language about trials is outdated.

## `GET /api/stripe/v2/agent-access`

Returns flags the FE layout uses to lock routes:

- `simone`, `olivia`, `ellis`, `plan`
- `subscriptionPaused`, `isPausePlan`, `resumePriceId`
- `subscriptionCancelled` — had subscriptions, none entitled, not pause
- `accessEndsAt`
- Simone counters: `simoneCreditsRemaining`, `simoneKitsUsed`, `simonePaymentsCount`, `simoneOneTimePaid`

FE `Layout` allows only `/`, `/dashboard`, `/dashboard/userprofile*`, `/dashboard/admin*` when paused or cancelled. Everything else toasts and redirects to the Subscription tab.

## `isSubscribedUser` (API)

Used on chat and novel AI routes.

| Condition | HTTP | `code` / message |
|---|---|---|
| Pause (`pause_collection` or price === `PAUSE_SUBSCRIPTION_PRICE`) | 403 | `SUBSCRIPTION_PAUSED` — generic or agent-specific ("resume Simone/Olivia/Ellis") |
| Ellis route without Studio prices | 403 | Ellis requires Studio |
| Olivia without Builder/Studio | 403 | Olivia requires Builder or Studio |
| Simone thread/chat without Builder/Studio **and** `simoneCreditsRemaining === 0` | 403 | `SIMONE_CREDIT_REQUIRED` |
| No paid Builder/Studio otherwise | 403 | Subscription required |

Simone **credits are not consumed** when the user already has Builder/Studio. Consumption happens in `chatController` on `POST /api/v1/thread` with `agentName: "simone"` (`consumeSimoneCreditIfRequired`).

## Pause vs cancel vs $7-only

| State | Stripe | FE lock | Simone |
|---|---|---|---|
| Builder/Studio active | matching price | Unlocked | Unlimited, no credit spend |
| Pause plan | `PAUSE_SUBSCRIPTION_PRICE` | Locked (dashboard + My Account only) | 403 |
| Cancel at period end | still entitled until `current_period_end` | Unlocked until then | Unlimited |
| Cancelled, period over | no entitled price | Same lock as pause | 403 unless credits remain **and** they never had a cancelled-sub lock — FE `subscriptionCancelled` locks coaches even if credits exist if all subs are cancelled |
| $7 only, never subscribed | no sub | Unlocked for dashboard; Olivia/Ellis modals | Credit-gated threads |

Pause UI copy says community stays open. There is **no** community bypass in `isSubscribedUser` or Layout.

Cancel UI says work will be deleted after the period. There is **no** automated novel purge on cancel. Access locks; data remains.

## Related code

- `config/tokenverify.js`
- `controllers/stripeController.js` — `getAgentAccess`, `getSubscription`, `getSubscriptionV2`
- `service/stripeService.js` — `getBuilderStudioPriceIds`, `pauseSubscriptionToPausePlan`, `requiresMembershipFee`
- FE: `src/utils/index.js`, `src/Pages/Layout/index.jsx`

Next: [Simone](04-simone.md)
