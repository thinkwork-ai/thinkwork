-- Purpose: eval results link to the thread turn whose stored workspace
--   projection snapshot the test case asserted against (dynamic workspace
--   U10, origin R17/AE5). Direct AgentCore eval sessions use synthetic
--   session IDs that never join to thread_turns, so the linkage is an
--   explicit nullable FK column. ON DELETE SET NULL: deleting a turn keeps
--   the eval result row (assertion outcomes are snapshotted in
--   eval_results.assertions) but drops the projection convenience read.
-- Plan: docs/plans/2026-06-12-002-feat-dynamic-workspace-plan.md U10
-- Apply manually (no CI migration runner):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0160_eval_results_thread_turn.sql
-- creates-column: public.eval_results.thread_turn_id
-- creates-constraint: public.eval_results.eval_results_thread_turn_id_thread_turns_id_fk

\set ON_ERROR_STOP on

SET lock_timeout = '5s';
SET statement_timeout = '15min';

SELECT pg_advisory_lock(hashtext('migration:0160_eval_results_thread_turn'));

ALTER TABLE public.eval_results
  ADD COLUMN IF NOT EXISTS thread_turn_id uuid;

DO $$
BEGIN
  ALTER TABLE public.eval_results
    ADD CONSTRAINT eval_results_thread_turn_id_thread_turns_id_fk
    FOREIGN KEY (thread_turn_id)
    REFERENCES public.thread_turns(id)
    ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

SELECT pg_advisory_unlock(hashtext('migration:0160_eval_results_thread_turn'));
