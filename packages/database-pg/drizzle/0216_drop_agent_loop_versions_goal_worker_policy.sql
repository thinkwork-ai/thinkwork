-- Purpose: DROP the now-inert agent_loop_versions.goal_spec, .worker_spec,
-- .loop_policy columns and promote target_spec to NOT NULL (THINK-159 U11,
-- PR B — the destructive follow-up to PR A #3351).
--
-- PR A (deployed) made target_spec the sole dispatch source: resolveDispatchableVersion
-- derives goalSpec/workerSpec from target_spec.agentThread and synthesizes
-- DEFAULT_LOOP_POLICY; saveAgentLoop stopped writing the three columns;
-- migration 0215 made them nullable. Every version row has target_spec
-- (backfilled by 0211), so the columns are pure dead weight.
--
-- Ordering (expand/contract, per docs/solutions/workflow-issues/
-- dropping-orm-declared-columns-needs-def-removal-deploy-first.md): this file's
-- companion PR removes the Drizzle column DEFINITIONS from
-- src/schema/agent-loops.ts, so the deployed ORM stops emitting them in
-- `.select()` star reads. This DROP is applied to a stage ONLY AFTER that
-- def-removal code is live there — never pre-applied while a prior deploy's
-- ORM still declares the columns.
--
-- Pre-flight: aborts if any version row has NULL target_spec (would become
-- undispatchable once the legacy fallback is gone). Idempotent (IF EXISTS).
--
-- Apply manually (verification pass before merge, AFTER the def-removal deploy):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
--     -f packages/database-pg/drizzle/0216_drop_agent_loop_versions_goal_worker_policy.sql
--
-- drops-column: public.agent_loop_versions.goal_spec
-- drops-column: public.agent_loop_versions.worker_spec
-- drops-column: public.agent_loop_versions.loop_policy
-- creates: public.view_agent_loop_versions_target_spec_required

\set ON_ERROR_STOP on

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('think159_drop_goal_worker_policy_0216'));

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  null_target_spec_count bigint;
BEGIN
  IF to_regclass('public.agent_loop_versions') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.agent_loop_versions does not exist';
  END IF;
  SELECT count(*) INTO null_target_spec_count
  FROM public.agent_loop_versions
  WHERE target_spec IS NULL;
  IF null_target_spec_count > 0 THEN
    RAISE EXCEPTION
      'pre-flight: % agent_loop_versions rows have NULL target_spec; re-run the 0211 backfill before dropping the legacy columns',
      null_target_spec_count;
  END IF;
END $$;

-- Obsolete nullability drift-marker view from 0215 (its columns are dropped
-- below); mirrors 0214 dropping the 0213 marker view.
DROP VIEW IF EXISTS public.view_agent_loop_versions_goal_worker_policy_nullable;

ALTER TABLE public.agent_loop_versions ALTER COLUMN target_spec SET NOT NULL;

ALTER TABLE public.agent_loop_versions
  DROP COLUMN IF EXISTS goal_spec,
  DROP COLUMN IF EXISTS worker_spec,
  DROP COLUMN IF EXISTS loop_policy;

-- Drift marker: presence proves the drop transaction committed and target_spec
-- is now required.
CREATE OR REPLACE VIEW public.view_agent_loop_versions_target_spec_required AS
SELECT
  bool_or(column_name = 'target_spec' AND is_nullable = 'NO') AS target_spec_not_null,
  bool_and(column_name NOT IN ('goal_spec', 'worker_spec', 'loop_policy')) AS legacy_columns_dropped,
  now() AS checked_at
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'agent_loop_versions';

COMMENT ON VIEW public.view_agent_loop_versions_target_spec_required IS
  'Drift marker for 0216_drop_agent_loop_versions_goal_worker_policy.sql (THINK-159 U11).';

COMMIT;
