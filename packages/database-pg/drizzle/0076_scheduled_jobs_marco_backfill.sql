-- Backfill: scheduled_jobs.computer_id for the two known Marco jobs (dev-only).
--
-- Resolves the target Computer UUID from a psql variable (no PII in the
-- committed file) and stage-guards against accidentally running on the
-- wrong database — if no Computer with the given id exists we RAISE
-- EXCEPTION rather than silently no-op or corrupt foreign tenant data.
--
-- Operator workflow (run from repo root with dev DATABASE_URL set):
--
--   COMPUTER_ID=$(psql "$DATABASE_URL" -tA -c \
--     "SELECT id FROM computers \
--      WHERE owner_user_id = (SELECT id FROM users WHERE email = '<owner-email>') \
--        AND status = 'active' \
--      LIMIT 1")
--   psql "$DATABASE_URL" \
--     -v computer_id="$COMPUTER_ID" \
--     -f packages/database-pg/drizzle/0076_scheduled_jobs_marco_backfill.sql
--
-- Idempotent: re-running with the same :computer_id is a no-op.
--
-- This is a data backfill, not a schema change — no creates: markers.

\set ON_ERROR_STOP on

-- Fail fast if the operator forgot to pass -v computer_id
\if :{?computer_id}
\else
  \echo 'ERROR: -v computer_id=<uuid> is required'
  \quit 1
\endif

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Stage guard: assert the target Computer actually exists in this DB.
-- A wrong-stage apply (staging/prod where the Marco Computer row
-- doesn't exist) raises here rather than silently affecting nothing or
-- corrupting tenant scoping on the two job rows.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.computers WHERE id = :'computer_id'::uuid
  ) THEN
    RAISE EXCEPTION 'Computer % not found — wrong stage or wrong UUID', :'computer_id';
  END IF;
END $$;

UPDATE public.scheduled_jobs
   SET computer_id = :'computer_id'::uuid,
       updated_at = now()
 WHERE id IN (
         'd8a56ed5-c504-4c62-b3c8-2152bc6fc7a1'::uuid,
         'e2429872-71ee-47fb-a084-431a302e4b35'::uuid
       )
   AND tenant_id = (
         SELECT tenant_id FROM public.computers WHERE id = :'computer_id'::uuid
       );

COMMIT;
