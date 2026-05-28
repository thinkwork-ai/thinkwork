-- Rollback for 0137_thread_participant_pins.sql.
-- Drops only server-side Thread pin state columns and index.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DROP INDEX IF EXISTS public.idx_thread_participants_user_pins;

ALTER TABLE public.thread_participants
  DROP COLUMN IF EXISTS pin_order,
  DROP COLUMN IF EXISTS pinned_at;

COMMIT;
