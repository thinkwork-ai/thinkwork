-- Rollback for 0128_drop_eval_test_cases_agent_id.sql.
--
-- Recreates the agent_id column and its FK constraint. The dropped values
-- (per-case Agent overrides) are NOT recoverable from this rollback —
-- they were already orphaned because the dedicated eval agent they pointed
-- at was archived by the platform-agent collapse migration. Rollback
-- restores schema compatibility only.
--
-- Plan: docs/plans/2026-05-23-006-refactor-evaluations-tenant-platform-agent-plan.md (U3)
--
-- Apply manually:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0128_drop_eval_test_cases_agent_id_rollback.sql

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.eval_test_cases
  ADD COLUMN IF NOT EXISTS agent_id uuid;

ALTER TABLE public.eval_test_cases
  ADD CONSTRAINT eval_test_cases_agent_id_agents_id_fk
    FOREIGN KEY (agent_id) REFERENCES public.agents(id);

COMMIT;
