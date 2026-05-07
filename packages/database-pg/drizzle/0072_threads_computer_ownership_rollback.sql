\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DROP INDEX IF EXISTS public.idx_threads_computer;

ALTER TABLE public.threads
  DROP COLUMN IF EXISTS computer_id;

COMMIT;
