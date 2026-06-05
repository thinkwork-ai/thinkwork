-- Purpose: add user-level cost attribution and user budget policy support.
-- Plan: docs/plans/2026-06-05-002-feat-user-cost-budgets-plan.md U1
-- Apply manually (no CI migration runner):
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0148_user_cost_attribution.sql
-- Pre-flight:
--   SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cost_events' AND column_name = 'user_id';
--   SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'budget_policies' AND column_name = 'user_id';
--   SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'scheduled_jobs' AND column_name = 'budget_paused';
-- creates-column: public.cost_events.user_id
-- creates-column: public.budget_policies.user_id
-- creates-column: public.scheduled_jobs.budget_paused
-- creates-column: public.scheduled_jobs.budget_paused_at
-- creates-column: public.scheduled_jobs.budget_paused_reason
-- creates: public.idx_cost_events_user_created
-- creates: public.idx_budget_policies_user
-- creates: public.idx_scheduled_jobs_budget_paused
-- creates-constraint: public.cost_events.cost_events_user_id_users_id_fk
-- creates-constraint: public.budget_policies.budget_policies_user_id_users_id_fk
-- creates-constraint: public.budget_policies.budget_policies_scope_check

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('migration:0148_user_cost_attribution'));

ALTER TABLE public.cost_events
  ADD COLUMN IF NOT EXISTS user_id uuid;

ALTER TABLE public.budget_policies
  ADD COLUMN IF NOT EXISTS user_id uuid;

ALTER TABLE public.scheduled_jobs
  ADD COLUMN IF NOT EXISTS budget_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS budget_paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS budget_paused_reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cost_events_user_id_users_id_fk'
      AND conrelid = 'public.cost_events'::regclass
  ) THEN
    ALTER TABLE public.cost_events
      ADD CONSTRAINT cost_events_user_id_users_id_fk
      FOREIGN KEY (user_id)
      REFERENCES public.users(id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'budget_policies_user_id_users_id_fk'
      AND conrelid = 'public.budget_policies'::regclass
  ) THEN
    ALTER TABLE public.budget_policies
      ADD CONSTRAINT budget_policies_user_id_users_id_fk
      FOREIGN KEY (user_id)
      REFERENCES public.users(id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'budget_policies_scope_check'
      AND conrelid = 'public.budget_policies'::regclass
  ) THEN
    ALTER TABLE public.budget_policies
      ADD CONSTRAINT budget_policies_scope_check
      CHECK (scope IN ('tenant', 'agent', 'user'));
  END IF;
END $$;

UPDATE public.cost_events ce
SET user_id = t.user_id
FROM public.threads t
WHERE ce.thread_id = t.id
  AND ce.tenant_id = t.tenant_id
  AND ce.user_id IS NULL
  AND t.user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cost_events_user_created
  ON public.cost_events (tenant_id, user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_budget_policies_user
  ON public.budget_policies (tenant_id, user_id);

CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_budget_paused
  ON public.scheduled_jobs (tenant_id, budget_paused);

COMMIT;
