-- Purpose: persist the running Computer selected for an eval run.
-- Plan: docs/plans/2026-05-16-002-feat-evals-overhaul-redteam-library-and-substrate-fix-plan.md (follow-up)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0095_eval_runs_computer_id.sql
-- creates-column: public.eval_runs.computer_id
-- creates-constraint: public.eval_runs.eval_runs_computer_id_computers_id_fk
-- creates: public.idx_eval_runs_tenant_computer_created

ALTER TABLE public.eval_runs
  ADD COLUMN IF NOT EXISTS computer_id uuid;

DO $$
BEGIN
  ALTER TABLE public.eval_runs
    ADD CONSTRAINT eval_runs_computer_id_computers_id_fk
    FOREIGN KEY (computer_id)
    REFERENCES public.computers(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_eval_runs_tenant_computer_created
  ON public.eval_runs(tenant_id, computer_id, created_at);
