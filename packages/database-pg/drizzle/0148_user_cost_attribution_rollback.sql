-- Rollback for 0148_user_cost_attribution.sql.
-- Prefer code rollback first. SQL rollback drops user attribution and
-- budget-pause state written after the forward migration; run it only with
-- explicit acceptance of that data loss or after taking a pre-rollback backup.
-- Apply manually:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0148_user_cost_attribution_rollback.sql
-- Post-rollback checks:
--   SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cost_events' AND column_name = 'user_id';
--   SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'budget_policies' AND column_name = 'user_id';
--   SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'scheduled_jobs' AND column_name LIKE 'budget_paused%';

\set ON_ERROR_STOP on

SET lock_timeout = '5s';
SET statement_timeout = '15min';

SELECT pg_advisory_lock(hashtext('migration:0148_user_cost_attribution_rollback'));

DROP INDEX CONCURRENTLY IF EXISTS public.idx_scheduled_jobs_budget_paused;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_budget_policies_user;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_cost_events_user_created;

ALTER TABLE IF EXISTS public.budget_policies
  DROP CONSTRAINT IF EXISTS budget_policies_scope_shape_check,
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

SELECT pg_advisory_unlock(hashtext('migration:0148_user_cost_attribution_rollback'));

RESET statement_timeout;
RESET lock_timeout;
