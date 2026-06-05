-- Rollback for 0148_user_cost_attribution.sql.
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0148_user_cost_attribution_rollback.sql

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('migration:0148_user_cost_attribution_rollback'));

DROP INDEX IF EXISTS public.idx_scheduled_jobs_budget_paused;
DROP INDEX IF EXISTS public.idx_budget_policies_user;
DROP INDEX IF EXISTS public.idx_cost_events_user_created;

ALTER TABLE IF EXISTS public.budget_policies
  DROP CONSTRAINT IF EXISTS budget_policies_scope_check,
  DROP CONSTRAINT IF EXISTS budget_policies_user_id_users_id_fk;

ALTER TABLE IF EXISTS public.cost_events
  DROP CONSTRAINT IF EXISTS cost_events_user_id_users_id_fk;

ALTER TABLE IF EXISTS public.scheduled_jobs
  DROP COLUMN IF EXISTS budget_paused_reason,
  DROP COLUMN IF EXISTS budget_paused_at,
  DROP COLUMN IF EXISTS budget_paused;

ALTER TABLE IF EXISTS public.budget_policies
  DROP COLUMN IF EXISTS user_id;

ALTER TABLE IF EXISTS public.cost_events
  DROP COLUMN IF EXISTS user_id;

COMMIT;
