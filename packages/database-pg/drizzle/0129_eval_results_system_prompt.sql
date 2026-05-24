-- 0129_eval_results_system_prompt.sql
--
-- Adds a nullable text column capturing the system prompt the agent loop
-- ran against during an eval invocation. Populated by the eval-worker from
-- the Pi runtime's `composed_system_prompt` response field; surfaced in the
-- admin "View System Prompt" sheet on the eval result detail.
--
-- Plan: docs/plans/2026-05-23-006-refactor-evaluations-tenant-platform-agent-plan.md
-- (post-merge feature follow-up from ce-debug session 2026-05-24)
--
-- Apply manually:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0129_eval_results_system_prompt.sql
-- Then verify:
--   bash scripts/db-migrate-manual.sh packages/database-pg/drizzle/0129_eval_results_system_prompt.sql
--
-- creates-column: public.eval_results.system_prompt

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '60s';

SELECT pg_advisory_xact_lock(hashtext('add_eval_results_system_prompt'));

ALTER TABLE public.eval_results
  ADD COLUMN IF NOT EXISTS system_prompt text;

COMMIT;
