-- 0133_thread_turns_system_prompt.sql
-- Store the composed system prompt captured for normal thread turns so the
-- admin Thread Detail view can audit the prompt used by the runtime.
--
-- Apply manually:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0133_thread_turns_system_prompt.sql
-- Verify:
--   bash scripts/db-migrate-manual.sh packages/database-pg/drizzle/0133_thread_turns_system_prompt.sql
--
-- creates-column: public.thread_turns.system_prompt

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('add_thread_turns_system_prompt'));

ALTER TABLE public.thread_turns
  ADD COLUMN IF NOT EXISTS system_prompt text;

COMMENT ON COLUMN public.thread_turns.system_prompt IS
  'Composed system prompt captured from the agent runtime for this turn.';

COMMIT;
