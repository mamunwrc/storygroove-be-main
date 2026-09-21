# 8. Diagnosing stuck users

Map writer complaints to checks. Quote messages from the FE troubleshooting chapter; confirm state here.

## 1. Paid but cannot log in

```
db.users.findOne({ email: "<stripe email lowercased>" }, {
  status: 1, passwordSetupRequired: 1, signupType: 1,
  verificationToken: 1, stripeCustomerId: 1, createdAt: 1
})
```

| Finding | Action |
|---|---|
| No user | Webhook missed or payment not `paid`. Stripe → session `checkout.session.completed`. Replay or run provisioner mentally from `provisionUserFromCheckoutSession`. Check `CheckoutProvision` for `sessionId`. |
| `status: "inactive"`, `passwordSetupRequired: true` | Verify email not completed. Resend `generate-new-token` or send forgot-password (reset **activates**). |
| `status: "active"`, `passwordSetupRequired: true` | Verify ran, password page not submitted. Forgot-password. |
| `status: "inactive"`, `passwordSetupRequired: false` | Classic bug: reset saved password without activating (fixed in `resetPassword`). Set `status: "active"` or have them reset again. |
| Token expired | First email 48h, resend 24h, reset 1h. |

Webhook logs: `checkout.session.completed: provisioned user …` vs `provisioning failed`.

## 2. Logged in but coaches locked

`GET /api/stripe/v2/agent-access` as the user (or inspect Stripe customer subscriptions).

| Flags | Meaning |
|---|---|
| `subscriptionPaused: true` | On `PAUSE_SUBSCRIPTION_PRICE` or `pause_collection`. Resume via `POST /api/stripe/resume` or Subscription tab. Confirm `pausedFromPriceId`. |
| `subscriptionCancelled: true` | No entitled price. Re-subscribe (`POST /api/stripe/create`). |
| `simone: false`, credits 0 | Need $7 Checkout or a plan. |
| `olivia: false` | Not Builder/Studio. |
| `ellis: false` | Not Studio. |

If Stripe Dashboard shows an active Builder price but `agent-access` disagrees: wrong env price IDs, or customer ID not on the User.

## 3. $7 paid, cannot start Simone

User should have `simoneCreditsRemaining >= 1` after webhook. If payment succeeded but credit is 0: session line items did not match `SIMONE_ONETIME_PRICE`, or increment ran against a different user. Compare Stripe customer id to `User.stripeCustomerId`.

Thread create error `SIMONE_CREDIT_REQUIRED` is expected after the credit is spent (one thread per $7).

## 4. Verify loop / "already verified"

`signupType: "stripe_checkout"` **is** allowed to resend. Social/Shopify is not. Active users without `passwordSetupRequired` cannot re-verify.

## 5. Pause resume failed

Need `PAUSE_SUBSCRIPTION_PRICE` and stored pre-pause price (`User.pausedFromPriceId` or Stripe metadata `pre_pause_price_id`).

## 6. Olivia / Ellis project errors

- Outline already exists → FE modal; not a billing issue.
- Ellis 403 → Builder customer; upgrade.
- Upload 400 → file type/size.
- Editing plan empty → no revision-plan inserts yet.
- Simone `simonePaused` on the thread → spend cap; not a billing pause.

## 7. Webhook vs live Stripe

If only `checkout.session.completed` is subscribed, do not expect Mongo `Subscriber` to track pause/cancel. Always open Stripe customer → Subscriptions.

Unhandled types log in `stripeWebhook`. SOP mentioning `invoice.paid` is stale; code listens for `invoice.payment_succeeded`.

## Related writer doc

`storygroove-fe/docs/user-guide/08-troubleshooting.md`

Back to [index](README.md)
