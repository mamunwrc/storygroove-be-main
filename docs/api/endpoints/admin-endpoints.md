# Admin endpoints — superadmin

Both routers apply **`authenticateUserWithoutOpenAI`** then **`requireSuperAdmin`**.

## `/api/admin/usage` (`apiUsageRoute.js`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/admin/usage/summary` | Dashboard aggregates (monthly cost, active users, rate-limit hits) |
| GET | `/api/admin/usage/users` | Paginated user list with monthly usage stats (`page`, `limit`, `sort`, `order`, `search`, `status`) |
| GET | `/api/admin/usage/users/:userId/history` | Per-user cost history (`months` query) |
| GET | `/api/admin/usage/rate-limit-events` | Rate limit event feed |
| POST | `/api/admin/usage/users/:userId/block` | Block user API usage |
| POST | `/api/admin/usage/users/:userId/unblock` | Unblock |
| PATCH | `/api/admin/usage/users/:userId/limit` | Adjust custom limits / monthly cap |
| GET | `/api/admin/usage/settings` | Global API usage settings |
| PATCH | `/api/admin/usage/settings` | Update settings |
| POST | `/api/admin/usage/recompute-costs` | Kick cost recompute job |
| GET | `/api/admin/usage/recompute-costs/:jobId` | Poll job status |

## `/api/admin/activity-logs` (`activityLogRoute.js`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/admin/activity-logs/` | Filtered activity log feed (`module`, `action`, `userId`, `email`, `source`, `startDate`, `endDate`, `page`, `limit`, …) |

See `controllers/activityLogController.js` for supported query parameters and response shape.

## Related admin surfaces

**`/api/assistant/*`** routes with **`requireAdmin`** / **`requireSuperAdmin`** are documented in **`assistant-endpoints.md`** (not duplicated here).
