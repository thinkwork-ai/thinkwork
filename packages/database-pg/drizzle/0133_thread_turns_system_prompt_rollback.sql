-- Rollback for 0133_thread_turns_system_prompt.sql.

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('add_thread_turns_system_prompt'));

ALTER TABLE public.thread_turns
  DROP COLUMN IF EXISTS system_prompt;

COMMIT;
