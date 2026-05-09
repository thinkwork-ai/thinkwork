-- Add nullable Computer ownership to Scheduled Jobs.
--
-- Mirrors `threads.computer_id` from drizzle/0072 — Computers are the
-- durable per-user workplace; agent_id stays as the runtime-firing key,
-- computer_id is the new ownership/filter key.
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0075_scheduled_jobs_computer_ownership.sql
--
-- creates-column: public.scheduled_jobs.computer_id
-- creates: public.idx_scheduled_jobs_computer

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.scheduled_jobs
  ADD COLUMN IF NOT EXISTS computer_id uuid REFERENCES public.computers(id);

CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_computer
  ON public.scheduled_jobs (tenant_id, computer_id)
  WHERE computer_id IS NOT NULL;

COMMIT;
