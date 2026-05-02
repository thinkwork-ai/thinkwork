-- Rollback for 0060_system_workflow_run_domain_ref_dedup.sql.

\set ON_ERROR_STOP on

BEGIN;

DROP INDEX IF EXISTS public.idx_system_workflow_runs_domain_ref_dedup;

COMMIT;
