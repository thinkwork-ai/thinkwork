-- 0141_eval_runs_desktop_pi_provenance.sql
--
-- Adds provenance and explicit selection tracking for desktop-local Pi eval
-- runs. Existing cloud/AgentCore rows backfill to the default values so
-- historical dashboards continue to read as AgentCore-backed runs.
--
-- Plan: docs/plans/2026-06-01-004-feat-desktop-pi-redteam-evals-plan.md (U2)
--
-- creates-column: public.eval_runs.execution_target
-- creates-column: public.eval_runs.runtime_host
-- creates-column: public.eval_runs.selected_test_case_ids
-- creates: public.idx_eval_runs_tenant_execution_target_created

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '120s';

SELECT pg_advisory_xact_lock(hashtext('eval_runs_desktop_pi_provenance'));

ALTER TABLE public.eval_runs
  ADD COLUMN IF NOT EXISTS execution_target text NOT NULL DEFAULT 'agentcore',
  ADD COLUMN IF NOT EXISTS runtime_host text NOT NULL DEFAULT 'aws-agentcore',
  ADD COLUMN IF NOT EXISTS selected_test_case_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

CREATE INDEX IF NOT EXISTS idx_eval_runs_tenant_execution_target_created
  ON public.eval_runs (tenant_id, execution_target, created_at);

COMMIT;
