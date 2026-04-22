-- Hand-rolled indexes for Stripe billing tables that drizzle-kit cannot
-- express (partial unique indexes + CHECK constraints).
--
-- Apply manually (matches 0018/0019/0020/0021 convention):
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0022_stripe_billing_indexes.sql
--
-- Drift detection:
--   pnpm db:migrate-manual
--
-- Pre-migration invariants:
--   - 0022_add_billing_tables.sql has been applied (tenants.pending_owner_email
--     exists; stripe_subscriptions exists).
--   - No collisions: a pre-existing partial unique index with the same name
--     would cause this script to fail (safe — intent is clear).
--
-- What this script enforces:
--   1. At most one tenant per pending_owner_email (only rows where the column
--      is non-null participate — freshly-claimed tenants don't collide).
--   2. At most one "active-ish" subscription per tenant. active / trialing /
--      past_due all count as active-ish; canceled/unpaid/incomplete do not.
--   3. stripe_subscriptions.status is one of the Stripe-documented values.
--      Kept as a CHECK (not an enum) so Stripe API changes don't require a
--      migration — the set is wide enough to cover all current states.
--
-- creates: public.tenants_pending_owner_email_uidx
-- creates: public.stripe_subscriptions_active_uidx
-- creates-check: public.stripe_subscriptions.status

CREATE UNIQUE INDEX IF NOT EXISTS "tenants_pending_owner_email_uidx"
  ON "tenants" (lower("pending_owner_email"))
  WHERE "pending_owner_email" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "stripe_subscriptions_active_uidx"
  ON "stripe_subscriptions" ("tenant_id")
  WHERE "status" IN ('active', 'trialing', 'past_due');

ALTER TABLE "stripe_subscriptions"
  ADD CONSTRAINT "stripe_subscriptions_status_allowed"
  CHECK ("status" IN (
    'incomplete',
    'incomplete_expired',
    'trialing',
    'active',
    'past_due',
    'canceled',
    'unpaid',
    'paused'
  ));
