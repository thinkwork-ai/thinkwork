-- Roll back routine_executions.routine_asl_version_id.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DROP INDEX IF EXISTS public.idx_routine_executions_asl_version;

ALTER TABLE public.routine_executions
  DROP COLUMN IF EXISTS routine_asl_version_id;

COMMIT;
