# API Usage Administration

## Summary

Super admins monitor OpenAI API usage and costs across users, configure global rate limits, block/unblock users, recompute costs, and review rate-limit hit events via a dedicated dashboard.

## Scope

**In scope:** Usage summary stats, per-user usage/history, rate limit events, user block/unblock, per-user limits, global settings, cost recompute jobs.

**Out of scope:** Runtime rate limit enforcement (middleware), writer-facing UI.

## Primary responsibilities

- Log API usage per request for cost tracking.
- Expose admin APIs and dashboard for usage analytics.
- Allow super admins to adjust limits and block abusive users.
- Recompute historical costs when pricing constants change.

## Dependencies

- Super-admin auth (`requireSuperAdmin`).
- ApiUsageLog, ApiUsageSettings, RateLimitEvent models.
- modelPricing constants.

## How to navigate the code

- Routes: `routers/apiUsageRoute.js` (mounted at `/api/admin/usage`)
- Controller: `controllers/apiUsageController.js`
- Middleware: `middleware/checkRateLimit.js`
- Models: `apiUsageLogModel.js`, `apiUsageSettingsModel.js`, `rateLimitEventModel.js`
- Constants: `constants/modelPricing.js`

## Open questions / gaps

- Cost recompute runs as async job; job status polled by job ID.
