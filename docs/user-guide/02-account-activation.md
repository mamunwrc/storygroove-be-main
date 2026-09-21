# 2. Account activation

Writer view: `storygroove-fe/docs/user-guide/02-account-setup.md`.

Checkout creates the User immediately. The writer cannot log in until the account is **active** and a real password is set.

## Status machine

`User.status`: `inactive` | `active` | `blocked` | `deleted`. Default `inactive`.

| Event | Status effect |
|---|---|
| Checkout provision / `POST /api/user/register` | `inactive` |
| `GET /api/user/verify/:token` success | `active`; clears `verificationToken` |
| `PATCH /api/user/resetPassword` success | `active` if it was `inactive`; `passwordSetupRequired: false`; unsets `verificationToken` |
| Admin `PUT /api/user/updatestatus/:id` | explicit |

Login (`POST /api/user/login`) order after password match:

1. `passwordSetupRequired` → 403 `PASSWORD_SETUP_REQUIRED`
2. `status === "inactive"` → 401 `ACCOUNT_UNVERIFIED`
3. Superadmin → 2FA challenge instead of JWT

`checkUserStatue` on the model still returns "not approved yet" for inactive; login uses the more specific messages above.

## Verify

`GET /api/user/verify/:token`

- Missing token → 400 `Invalid token`
- `status === "active"` **and** not `passwordSetupRequired` → 400 `User already verified`
- Expired → 400 `Token expired`
- Else set `status: "active"`, clear token

Checkout / `passwordSetupRequired` response (no JWT):

```
message: "Account verified — now create your password."
passwordSetupRequired: true
userId
setupToken   // plaintext ResetToken, hashed in Token collection, TTL 1 hour
```

FE redirects to `/passwordReset/{setupToken}/{userId}`.

Register-type users (not used on the marketing site) receive a JWT from verify instead.

## Password setup / reset

`PATCH /api/user/resetPassword` `{ userId, token, password }`

Valid bcrypt compare against `Token` for that userId. Then `$set` hashed password, `passwordSetupRequired: false`, and `status: "active"` when inactive.

This is the recovery path when the verify link expired: `POST /api/user/forgotpassword/` emails `Password Reset Request` (1 hour). Completing it **activates** the account. That is intentional: possession of the mailbox is treated as verification.

Do not hash the password in the controller *and* rely on the `pre("save")` hook — this path uses `User.updateOne` with a bcrypt hash already applied.

## Resend verification

`POST /api/user/generate-new-token` `{ email }`

- Unknown email → 200 generic success (no enumeration)
- Already `active` → 400 `User already verified`
- `signupType` not in `register` | `stripe_checkout` → 400 (social/Shopify have nothing to verify)
- Cooldown 60s → 429 `EMAIL_COOLDOWN`
- New token TTL **24 hours** (`VERIFICATION_TOKEN_TTL_MS`)

Register-first tokens in `auth.js` still expire in **15 minutes**. Production writers never hit that path.

## Emails

| Subject | Trigger | Link TTL |
|---|---|---|
| Verify your email address. | Provision / resend | 48h first, 24h resend |
| Password Reset Request | Forgot password | 1h (`Token.createdAt` expires 3600s) |
| Your StoryGroove verification code | Superadmin login | 10 min, 5 attempts |
| You're invited to subscribe to StoryGroove | Admin invite | Stripe Checkout link |

From: `StoryGroove Support Team <NODE_MAILER_USER>`. Templates: `utils/template/`. Sender: `utils/mailGun.js`.

## Related code

- `controllers/userController.js` — `verifyToken`, `resetPassword`, `generateNewToken`, `UpdateUserPassword`
- `controllers/auth.js` — `loginUser`, `registerUser`
- `models/user.js`, `models/token.js`
- `docs/api/endpoints/user-endpoints.md`

Next: [Entitlements](03-entitlements.md)
