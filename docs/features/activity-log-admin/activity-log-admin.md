# Activity Log Administration

## Summary

Super admins view a searchable activity log of significant user and system events for support, auditing, and debugging.

## Scope

**In scope:** List/filter activity logs via admin API and dashboard.

**Out of scope:** API usage metrics (api-usage-admin), application error tracking.

## Primary responsibilities

- Persist activity events with typed categories.
- Expose paginated list endpoint for super admins.
- Expose paginated activity log API for super-admin consumers.

## Dependencies

- Super-admin auth.
- ActivityLog model and activityLog constants.

## How to navigate the code

- Routes: `routers/activityLogRoute.js` (mounted at `/api/admin/activity-logs`)
- Controller: `controllers/activityLogController.js`
- Model: `models/activityLogModel.js`
- Constants: `constants/activityLog.js`

## Open questions / gaps

- Event emission coverage may vary by feature; not all actions are logged.
