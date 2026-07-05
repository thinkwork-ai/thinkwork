-- Purpose: DROP the judge / evidence / ROI schema for Automations
-- (THINK-137 U10, PR B — destructive schema removal).
--
-- Migration ordering: this is the SECOND and final U10 migration. PR A (0213)
-- removed every reader/writer of the judge / evidence / ROI feature from code
-- and made agent_loop_versions.judge_spec + evidence_policy nullable so
-- saveAgentLoop could legally stop writing them. PR A has deployed and
-- saveAgentLoop was observed creating Automations live WITHOUT these columns.
-- Only now — after the code-removal PR is live — is it safe to DROP the
-- columns and tables nothing reads or writes anymore. Running this before PR A
-- deployed would break live writers, hence the strict A→B ordering.
--
-- Drops (in FK-safe order):
--   1. public.agent_loop_evidence      (has FK agent_loop_judgment_id ->
--                                        agent_loop_judgments.id, so it goes
--                                        FIRST)
--   2. public.agent_loop_judgments
--   3. public.agent_loops.{accepted_run_count, rejected_run_count,
--        escalated_run_count, total_cost_usd_cents,
--        cost_per_accepted_run_usd_cents}   (ROI counters)
--   4. public.agent_loop_versions.{judge_spec, evidence_policy}
--        (already nullable from 0213)
--
-- Explicitly NOT touched: agent_loops' goal_spec/worker_spec/loop_policy/
-- target_spec/policy_snapshot are deferred to U11; agent_loop_runs and
-- agent_loop_iterations keep their own total_cost_usd_cents (U4 cost-cap gate);
-- workflow_runs.total_cost_usd_cents is unrelated.
--
-- This is a hand-rolled DDL migration that Drizzle's generator does not track.
-- Following the 0210-0213 precedent it uses drop markers (`-- drops:` /
-- `-- drops-column:`) so the drift reporter (scripts/db-migrate-manual.sh) can
-- prove each object is ABSENT (DROPPED) in the target DB after apply. It also
-- drops the now-meaningless 0213 drift-marker view, whose only reason to exist
-- was to prove the nullability step that this migration supersedes.
--
-- Idempotent: every statement uses IF EXISTS, so re-running is a no-op.
--
-- Apply manually (verification pass before merge):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
--     -f packages/database-pg/drizzle/0214_think137_drop_judge_evidence_roi.sql
--
-- drops: public.agent_loop_evidence
-- drops: public.agent_loop_judgments
-- drops-column: public.agent_loops.accepted_run_count
-- drops-column: public.agent_loops.rejected_run_count
-- drops-column: public.agent_loops.escalated_run_count
-- drops-column: public.agent_loops.total_cost_usd_cents
-- drops-column: public.agent_loops.cost_per_accepted_run_usd_cents
-- drops-column: public.agent_loop_versions.judge_spec
-- drops-column: public.agent_loop_versions.evidence_policy

\set ON_ERROR_STOP on

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('think137_drop_judge_evidence_roi_0214'));

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Pre-flight: the parent tables whose columns we alter must exist. (The
-- judge/evidence tables themselves are dropped with IF EXISTS, so their
-- absence is fine.)
DO $$
BEGIN
  IF to_regclass('public.agent_loops') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.agent_loops does not exist';
  END IF;
  IF to_regclass('public.agent_loop_versions') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.agent_loop_versions does not exist';
  END IF;
END $$;

-- Drop the now-obsolete 0213 drift-marker view. It probed judge_spec /
-- evidence_policy nullability via information_schema (a name reference, not a
-- real column dependency), so it does not block the column drops — but it is
-- meaningless once the columns are gone.
DROP VIEW IF EXISTS public.view_agent_loop_versions_judge_evidence_nullable;

-- 1. Evidence first (FK agent_loop_judgment_id -> agent_loop_judgments.id).
DROP TABLE IF EXISTS public.agent_loop_evidence;

-- 2. Then judgments.
DROP TABLE IF EXISTS public.agent_loop_judgments;

-- 3. ROI counters on agent_loops (NOT agent_loop_runs/iterations cost columns).
ALTER TABLE public.agent_loops
  DROP COLUMN IF EXISTS accepted_run_count,
  DROP COLUMN IF EXISTS rejected_run_count,
  DROP COLUMN IF EXISTS escalated_run_count,
  DROP COLUMN IF EXISTS total_cost_usd_cents,
  DROP COLUMN IF EXISTS cost_per_accepted_run_usd_cents;

-- 4. judge_spec / evidence_policy on agent_loop_versions (nullable since 0213).
ALTER TABLE public.agent_loop_versions
  DROP COLUMN IF EXISTS judge_spec,
  DROP COLUMN IF EXISTS evidence_policy;

COMMIT;
