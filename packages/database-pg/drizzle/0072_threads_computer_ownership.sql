-- Add nullable Computer ownership to Threads for the feature-flagged
-- ThinkWork Computer cutover.
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0072_threads_computer_ownership.sql
--
-- creates-column: public.threads.computer_id
-- creates: public.idx_threads_computer

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.threads
  ADD COLUMN IF NOT EXISTS computer_id uuid REFERENCES public.computers(id);

CREATE INDEX IF NOT EXISTS idx_threads_computer
  ON public.threads (tenant_id, computer_id)
  WHERE computer_id IS NOT NULL;

COMMIT;
