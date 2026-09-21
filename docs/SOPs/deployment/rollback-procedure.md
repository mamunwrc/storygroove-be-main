# Rollback procedure — storygroove-be

## When to rollback

Sustained **5xx** rates, corrupt writes, or broken Stripe webhook processing are typical triggers.

## Steps

1. **Redeploy** the last known-good build artifact or git SHA.
2. **Verify** health endpoint and a sampled authenticated flow.
3. **Mongo**: if a bad migration wrote partial data, restore from backup or run a corrective script—coordinate with DBA policies.
4. **Stripe**: replay or reconcile events after recovery using Stripe dashboard tools if webhooks were skipped.
5. **Communicate** incident summary and customer impact per company policy.

## Prevention

Keep deployments small and feature-flag risky Olivia memory changes when possible.
