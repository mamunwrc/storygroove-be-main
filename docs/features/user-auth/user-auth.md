# User Authentication and Profile

## Summary

Writers register, log in (with optional two-factor authentication), reset passwords, verify email tokens, and manage profile settings including OpenAI API keys. Admins can list users, update status, and unlock accounts.

## Scope

**In scope:** Email/password login, 2FA, registration, JWT sessions, password reset, profile updates, profile photo upload, OpenAI key storage, admin user management.

**Out of scope:** Stripe subscription state (see subscriptions-billing), novel data access.

## Primary responsibilities

- Issue and validate JWT tokens for API access.
- Register new users and send verification flows.
- Support login 2FA verification and resend.
- Allow password change, forgot-password, and token-based reset.
- Expose profile read/update and profile picture upload/remove.
- Store per-user OpenAI API keys when provided.
- Admin endpoints for user listing, status updates, and account unlock.

## Dependencies

- JWT (`JWT_SECRET`), MongoDB User and Token models.
- Multer for profile picture uploads.
- Optional SendGrid or similar for email (env-dependent).

## How to navigate the code

- Backend routes: `routers/userRoute.js`
- Auth controllers: `controllers/auth.js`, `controllers/userController.js`
- JWT middleware: `config/tokenverify.js`

## Open questions / gaps

- Google OAuth callback route exists in App.js but integration details vary by deployment.
