-- Routine executions: persist the ASL version row used for each run.
--
-- New manual Test Routine executions can then resolve the exact
-- routine_asl_versions row even when Step Functions execution metadata
-- does not provide a version ARN. Existing rows remain valid with null.
--
-- Plan:
--   docs/plans/2026-05-02-011-feat-routine-execution-aware-editing-plan.md
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0061_routine_execution_asl_version_id.sql
--
-- creates-column: public.routine_executions.routine_asl_version_id
-- creates: public.idx_routine_executions_asl_version

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.routine_executions
  ADD COLUMN IF NOT EXISTS routine_asl_version_id uuid REFERENCES public.routine_asl_versions(id);

CREATE INDEX IF NOT EXISTS idx_routine_executions_asl_version
  ON public.routine_executions (routine_asl_version_id);

COMMIT;
