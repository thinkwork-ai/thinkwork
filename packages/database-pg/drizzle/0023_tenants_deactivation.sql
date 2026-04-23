-- Tenant soft-delete columns.
--
-- Set by the stripe-webhook Lambda when customer.subscription.deleted
-- fires. A separate scheduled sweeper (future PR) hard-deletes rows where
-- deactivated_at < now() - 30 days.
--
-- See docs/plans/2026-04-23-001-feat-stripe-upgrade-and-cancel-soft-delete-plan.md
-- (Unit 1).
--
-- Apply manually (matches the 0018+ hand-rolled convention):
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0023_tenants_deactivation.sql
--
-- Drift detection:
--   pnpm db:migrate-manual
--
-- Pre-migration invariants:
--   - tenants exists.
--   - tenants.deactivated_at + tenants.deactivation_reason do not yet exist.
--
-- creates-column: public.tenants.deactivated_at
-- creates-column: public.tenants.deactivation_reason

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "deactivated_at" timestamp with time zone;

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "deactivation_reason" text;
