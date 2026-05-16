-- Purpose: link scheduled evaluation runs back to the scheduled job that created them.
-- Plan: docs/plans/2026-05-16-002-feat-evals-overhaul-redteam-library-and-substrate-fix-plan.md (U11)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0093_eval_runs_scheduled_job_id.sql
-- creates-column: public.eval_runs.scheduled_job_id
-- creates-constraint: public.eval_runs.eval_runs_scheduled_job_id_scheduled_jobs_id_fk
-- creates: public.idx_eval_runs_scheduled_job_id

ALTER TABLE public.eval_runs
  ADD COLUMN IF NOT EXISTS scheduled_job_id uuid;

DO $$
BEGIN
  ALTER TABLE public.eval_runs
    ADD CONSTRAINT eval_runs_scheduled_job_id_scheduled_jobs_id_fk
    FOREIGN KEY (scheduled_job_id)
    REFERENCES public.scheduled_jobs(id)
    ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_eval_runs_scheduled_job_id
  ON public.eval_runs(scheduled_job_id);
