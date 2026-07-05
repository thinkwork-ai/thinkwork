-- Purpose: drop the NOT NULL constraint on
-- agent_loop_versions.goal_spec, .worker_spec, and .loop_policy
-- (THINK-159 U11, PR A — code removal + nullability).
--
-- target_spec is now the SOLE dispatch source: resolveDispatchableVersion,
-- finalize-projection, the schedule/manual/webhook dispatch SELECTs, and the
-- automations list all derive goal/worker/loop-policy from target_spec (or the
-- DEFAULT_LOOP_POLICY) and no longer read these three columns. saveAgentLoop
-- has stopped writing them, and the GraphQL + web readers are gone. All three
-- columns were NOT NULL, so the write-stop is only legal once they are
-- nullable. This migration makes that write-stop legal. The COLUMNS themselves
-- are DROPPED in the follow-up PR B, after this deploys and saveAgentLoop is
-- observed creating Automations live.
--
-- Behavior-preserving: every live version row already carries a backfilled
-- target_spec (migration 0211), and the form never set loop_policy, so every
-- stored loop_policy already equalled DEFAULT_LOOP_POLICY.
--
-- Schema-only migration on existing columns. Following the 0202/0211/0213
-- precedent for hand-rolled DDL that Drizzle's generator does not track, it
-- publishes a drift-marker VIEW whose columns reflect the resulting nullability
-- so the drift reporter (scripts/db-migrate-manual.sh) can prove the ALTERs
-- committed; the `-- creates:` marker below is what the reporter probes.
--
-- Idempotent: ALTER COLUMN ... DROP NOT NULL is a no-op when the constraint is
-- already gone; the marker view is CREATE OR REPLACE. Safe to re-run.
--
-- Apply manually (verification pass before merge):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
--     -f packages/database-pg/drizzle/0215_agent_loop_versions_goal_worker_policy_nullable.sql
--
-- creates: public.view_agent_loop_versions_goal_worker_policy_nullable

\set ON_ERROR_STOP on

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('agent_loop_versions_goal_worker_policy_nullable_0215'));

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF to_regclass('public.agent_loop_versions') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.agent_loop_versions does not exist';
  END IF;
END $$;

ALTER TABLE public.agent_loop_versions ALTER COLUMN goal_spec DROP NOT NULL;
ALTER TABLE public.agent_loop_versions ALTER COLUMN worker_spec DROP NOT NULL;
ALTER TABLE public.agent_loop_versions ALTER COLUMN loop_policy DROP NOT NULL;

-- Drift marker. Its boolean columns reflect the resulting nullability so the
-- reporter can prove all three constraints were dropped.
CREATE OR REPLACE VIEW public.view_agent_loop_versions_goal_worker_policy_nullable AS
SELECT
  bool_or(column_name = 'goal_spec' AND is_nullable = 'YES') AS goal_spec_nullable,
  bool_or(column_name = 'worker_spec' AND is_nullable = 'YES') AS worker_spec_nullable,
  bool_or(column_name = 'loop_policy' AND is_nullable = 'YES') AS loop_policy_nullable,
  now() AS checked_at
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'agent_loop_versions'
  AND column_name IN ('goal_spec', 'worker_spec', 'loop_policy');

COMMENT ON VIEW public.view_agent_loop_versions_goal_worker_policy_nullable IS
  'Drift marker for 0215_agent_loop_versions_goal_worker_policy_nullable.sql.';

COMMIT;
