-- 0134_drop_dead_agent_runtime_tables.sql
--
-- Drops three agent_* tables that were schema-only across the codebase
-- with zero rows in production:
--
--   - agent_runtime_state    — declared but never written to
--   - agent_task_sessions    — declared but never written to;
--                              FKs to agent_runtime_state
--   - agent_workspace_waits  — declared but only re-exported in
--                              graphql/utils.ts; no SELECT/INSERT
--                              from any handler or resolver
--
-- Pre-merge consumer survey (per feedback_grep_must_match_import_form):
-- grep across apps/, packages/api/src, packages/lambda,
-- packages/database-pg/src (excluding drizzle/ and the table's own
-- schema declaration), packages/agentcore-strands, packages/agentcore-pi,
-- and scripts/ returned only the schema definitions + the utils.ts
-- re-exports. The companion code commit removes those.
--
-- Order matters: agent_task_sessions has a FK to agent_runtime_state,
-- so it must drop first.
--
-- Apply manually AFTER merge+deploy per feedback_migration_deploy_ordering.
-- (Risk in practice is zero — no code reads these — but consistent
-- with the ordering rule.)
--
-- Markers (consumed by scripts/db-migrate-manual.sh):
--
-- drops: public.agent_task_sessions
-- drops: public.agent_runtime_state
-- drops: public.agent_workspace_waits

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '60s';

SELECT pg_advisory_xact_lock(hashtext('drop_dead_agent_runtime_tables'));

DO $$
BEGIN
  IF current_database() != 'thinkwork' THEN
    RAISE EXCEPTION 'wrong database: %, expected thinkwork', current_database();
  END IF;
END $$;

-- Drop child first (FK to agent_runtime_state).
DROP TABLE IF EXISTS public.agent_task_sessions;
DROP TABLE IF EXISTS public.agent_runtime_state;
DROP TABLE IF EXISTS public.agent_workspace_waits;

COMMIT;
