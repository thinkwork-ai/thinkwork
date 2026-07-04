-- Purpose: add the routine-actions field to Automation versions
-- (deterministic routines v1, plan 2026-07-03-004 U5, R7). Null on
-- versions without routine actions; otherwise a jsonb
-- {actions: [{routineId, input?, label?}], agentTurn: boolean} where
-- agentTurn=false marks a routine-only Automation (run completes with
-- zero agent turns / no wakeup).
--
-- Schema-only change matching src/schema/agent-loops.ts
-- (agent_loop_versions.routine_actions_spec jsonb). Hand-rolled per
-- convention — the drizzle snapshot in meta/ is frozen
-- (precedent: 0205_routines_git_python.sql).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Safe to re-run.
--
-- Apply manually (verification pass before merge):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
--     -f packages/database-pg/drizzle/0206_agent_loop_versions_routine_actions.sql
--
-- creates-column: public.agent_loop_versions.routine_actions_spec

\set ON_ERROR_STOP on

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('agent_loop_versions_routine_actions_0206'));

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF to_regclass('public.agent_loop_versions') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.agent_loop_versions does not exist';
  END IF;
END $$;

ALTER TABLE public.agent_loop_versions
  ADD COLUMN IF NOT EXISTS routine_actions_spec jsonb;

COMMIT;
