\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DROP INDEX IF EXISTS public.idx_scheduled_jobs_computer;

ALTER TABLE public.scheduled_jobs
  DROP COLUMN IF EXISTS computer_id;

COMMIT;
