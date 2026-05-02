-- System Workflow run domain-ref idempotency.
--
-- Adds the database-enforced dedupe boundary used by the live System
-- Workflow launcher. A domain-backed workflow run, such as
-- evaluation-runs -> eval_runs.id, must not produce duplicate
-- system_workflow_runs rows when GraphQL/Lambda retries race.
--
-- Plan:
--   docs/plans/2026-05-02-008-feat-system-workflow-runtime-eval-adapter-plan.md
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0060_system_workflow_run_domain_ref_dedup.sql
--
-- creates: public.idx_system_workflow_runs_domain_ref_dedup

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE UNIQUE INDEX IF NOT EXISTS idx_system_workflow_runs_domain_ref_dedup
  ON public.system_workflow_runs (
    tenant_id,
    workflow_id,
    domain_ref_type,
    domain_ref_id
  )
  WHERE domain_ref_type IS NOT NULL
    AND domain_ref_id IS NOT NULL;

COMMIT;
