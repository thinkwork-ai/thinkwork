-- Rollback for 0055_routines_stepfunctions_substrate.sql
--
-- Drops the four new routine_* tables and removes the engine partition +
-- Step-Functions-specific columns from routines. Idempotent — safe to
-- run on a partial-apply.
--
-- WARNING: this destroys all routine_executions and routine_step_events
-- rows. Only run if you're rolling back the substrate before any real
-- routine has used it.
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0055_routines_stepfunctions_substrate_rollback.sql

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DROP TABLE IF EXISTS public.routine_approval_tokens;
DROP TABLE IF EXISTS public.routine_step_events;
DROP TABLE IF EXISTS public.routine_asl_versions;
DROP TABLE IF EXISTS public.routine_executions;

ALTER TABLE public.routines
  DROP CONSTRAINT IF EXISTS routines_engine_enum;

ALTER TABLE public.routines
  DROP COLUMN IF EXISTS engine,
  DROP COLUMN IF EXISTS state_machine_arn,
  DROP COLUMN IF EXISTS state_machine_alias_arn,
  DROP COLUMN IF EXISTS documentation_md,
  DROP COLUMN IF EXISTS current_version;

DROP INDEX IF EXISTS public.idx_routines_engine;

COMMIT;
