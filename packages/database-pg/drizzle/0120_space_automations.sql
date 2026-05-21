-- Purpose: scope scheduled jobs and webhooks to Spaces for the admin Space Automations tab.
-- Plan: docs/plans/2026-05-21-005-feat-admin-space-studio-simplification-plan.md (U5)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0120_space_automations.sql
-- creates-column: public.scheduled_jobs.space_id
-- creates-column: public.webhooks.space_id
-- creates: public.idx_scheduled_jobs_space
-- creates: public.idx_webhooks_space
-- creates-constraint: public.scheduled_jobs.scheduled_jobs_space_id_spaces_id_fk
-- creates-constraint: public.webhooks.webhooks_space_id_spaces_id_fk

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.scheduled_jobs
  ADD COLUMN IF NOT EXISTS space_id uuid;

ALTER TABLE public.webhooks
  ADD COLUMN IF NOT EXISTS space_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'scheduled_jobs_space_id_spaces_id_fk'
      AND conrelid = 'public.scheduled_jobs'::regclass
  ) THEN
    ALTER TABLE public.scheduled_jobs
      ADD CONSTRAINT scheduled_jobs_space_id_spaces_id_fk
      FOREIGN KEY (space_id)
      REFERENCES public.spaces(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'webhooks_space_id_spaces_id_fk'
      AND conrelid = 'public.webhooks'::regclass
  ) THEN
    ALTER TABLE public.webhooks
      ADD CONSTRAINT webhooks_space_id_spaces_id_fk
      FOREIGN KEY (space_id)
      REFERENCES public.spaces(id);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_space
  ON public.scheduled_jobs (tenant_id, space_id);

CREATE INDEX IF NOT EXISTS idx_webhooks_space
  ON public.webhooks (tenant_id, space_id);

COMMIT;
