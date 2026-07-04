-- Purpose: additive schema foundation for THINK-137 Automations
-- (plan 2026-07-03 U1). Lands every new column additively so later units
-- build on deployed schema. Additive DDL only — no drops of columns/tables,
-- no destructive data change. The one CHECK re-create (iteration status) is a
-- pure widening (7 → 9 accepted values); dropping-to-recreate a CHECK is not
-- a destructive data change.
--
-- Contents:
--   * agent_loop_versions.target_spec jsonb (nullable) — Automation target
--     resolution spec; populated by later units.
--   * agent_loops.run_as_user_id uuid (nullable) FK users(id) ON DELETE SET
--     NULL — matches the owner_user_id FK style on the same table.
--   * webhooks.agent_loop_id uuid (nullable) FK agent_loops(id) ON DELETE
--     CASCADE — a webhook bound to an Automation is torn down with it.
--   * agent_loop_iterations_status_check widened from the current 7-value set
--     to the 9-value set the run-ledger code (packages/agent-loops-core/
--     src/run-ledger.ts AgentLoopIterationStatus) treats as authoritative —
--     adds 'escalated' and 'skipped'. The sibling agent_loop_runs_status_check
--     already carries all 9, so this closes the iterations/runs skew.
--
-- NOT done here (deliberately):
--   * trigger-family CHECKs (agent_loops_trigger_family_check /
--     agent_loop_runs_trigger_family_check) already accept 'webhook' — no
--     widening required. Narrowing away dead families (api/app_event/n8n) is
--     U10's job, not this unit's.
--   * webhooks.target_type has no CHECK constraint (handler-enforced) — none
--     is added here.
--
-- Hand-rolled per convention (drizzle snapshot in meta/ is frozen;
-- precedent 0206/0207/0209). Idempotent: ADD COLUMN IF NOT EXISTS + guarded
-- CHECK drop/re-add. Safe to re-run.
--
-- Apply manually (verification pass before merge):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
--     -f packages/database-pg/drizzle/0210_think137_automations_additive_schema.sql
--
-- creates-column: public.agent_loop_versions.target_spec
-- creates-column: public.agent_loops.run_as_user_id
-- creates-column: public.webhooks.agent_loop_id
-- creates-constraint: public.agent_loop_iterations.agent_loop_iterations_status_check

\set ON_ERROR_STOP on

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('think137_automations_additive_schema_0210'));

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF to_regclass('public.agent_loop_versions') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.agent_loop_versions does not exist';
  END IF;
  IF to_regclass('public.agent_loops') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.agent_loops does not exist';
  END IF;
  IF to_regclass('public.agent_loop_iterations') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.agent_loop_iterations does not exist';
  END IF;
  IF to_regclass('public.webhooks') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.webhooks does not exist';
  END IF;
  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.users does not exist';
  END IF;
END $$;

-- agent_loop_versions.target_spec — nullable jsonb, no FK.
ALTER TABLE public.agent_loop_versions
  ADD COLUMN IF NOT EXISTS target_spec jsonb;

-- agent_loops.run_as_user_id — nullable uuid FK to users(id) ON DELETE SET
-- NULL (matches agent_loops.owner_user_id).
ALTER TABLE public.agent_loops
  ADD COLUMN IF NOT EXISTS run_as_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

-- webhooks.agent_loop_id — nullable uuid FK to agent_loops(id) ON DELETE
-- CASCADE.
ALTER TABLE public.webhooks
  ADD COLUMN IF NOT EXISTS agent_loop_id uuid REFERENCES public.agent_loops(id) ON DELETE CASCADE;

-- Widen the iteration status CHECK: 7 → 9 accepted values (add 'escalated',
-- 'skipped'). Guarded drop/re-add so re-runs are no-ops once the widened
-- definition is in place.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_loop_iterations_status_check'
      AND conrelid = 'public.agent_loop_iterations'::regclass
      AND (pg_get_constraintdef(oid) NOT LIKE '%escalated%'
        OR pg_get_constraintdef(oid) NOT LIKE '%skipped%')
  ) THEN
    ALTER TABLE public.agent_loop_iterations
      DROP CONSTRAINT agent_loop_iterations_status_check;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_loop_iterations_status_check'
      AND conrelid = 'public.agent_loop_iterations'::regclass
  ) THEN
    ALTER TABLE public.agent_loop_iterations
      ADD CONSTRAINT agent_loop_iterations_status_check
      CHECK (status IN ('queued', 'running', 'waiting_for_human', 'completed', 'failed', 'budget_stopped', 'escalated', 'canceled', 'skipped'));
  END IF;
END $$;

COMMIT;
