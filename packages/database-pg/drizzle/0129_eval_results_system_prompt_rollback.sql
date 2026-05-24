-- Rollback for 0129_eval_results_system_prompt.sql.
--
-- Drops the captured system_prompt column. The captured prompts are
-- regenerable on the next eval run; rollback is non-destructive of source
-- data.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.eval_results
  DROP COLUMN IF EXISTS system_prompt;

COMMIT;
