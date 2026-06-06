-- Purpose: add user-level cost attribution and user budget policy support.
-- Plan: docs/plans/2026-06-05-002-feat-user-cost-budgets-plan.md U1
-- Apply manually (no CI migration runner):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0148_user_cost_attribution.sql
-- Pre-flight:
--   SELECT scope, count(*) FROM public.budget_policies GROUP BY scope;
--   SELECT count(*) FROM public.cost_events WHERE user_id IS NULL;
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
-- creates-constraint: public.budget_policies.budget_policies_scope_shape_check

\set ON_ERROR_STOP on

SET lock_timeout = '5s';
SET statement_timeout = '15min';

SELECT pg_advisory_lock(hashtext('migration:0148_user_cost_attribution'));

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
      REFERENCES public.users(id)
      NOT VALID;
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
      REFERENCES public.users(id)
      NOT VALID;
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
      CHECK (scope IN ('tenant', 'agent', 'user'))
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'budget_policies_scope_shape_check'
      AND conrelid = 'public.budget_policies'::regclass
  ) THEN
    ALTER TABLE public.budget_policies
      ADD CONSTRAINT budget_policies_scope_shape_check
      CHECK (
        (scope = 'tenant' AND agent_id IS NULL AND user_id IS NULL)
        OR (scope = 'agent' AND agent_id IS NOT NULL AND user_id IS NULL)
        OR (scope = 'user' AND agent_id IS NULL AND user_id IS NOT NULL)
      )
      NOT VALID;
  END IF;
END $$;

DROP PROCEDURE IF EXISTS public.backfill_cost_events_user_id_0148(integer);

CREATE PROCEDURE public.backfill_cost_events_user_id_0148(batch_size integer)
LANGUAGE plpgsql
AS $$
DECLARE
  updated_count integer;
BEGIN
  LOOP
    WITH batch AS (
      SELECT ce.id, t.user_id
      FROM public.cost_events ce
      JOIN public.threads t
        ON t.id = ce.thread_id
       AND t.tenant_id = ce.tenant_id
      WHERE ce.user_id IS NULL
        AND t.user_id IS NOT NULL
      ORDER BY ce.created_at, ce.id
      LIMIT batch_size
      FOR UPDATE OF ce SKIP LOCKED
    )
    UPDATE public.cost_events ce
    SET user_id = batch.user_id
    FROM batch
    WHERE ce.id = batch.id;

    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RAISE NOTICE '0148_user_cost_attribution: backfilled % cost_events rows', updated_count;
    EXIT WHEN updated_count = 0;

    COMMIT;
  END LOOP;
END;
$$;

CALL public.backfill_cost_events_user_id_0148(5000);

DROP PROCEDURE IF EXISTS public.backfill_cost_events_user_id_0148(integer);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cost_events_user_created
  ON public.cost_events (tenant_id, user_id, created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_budget_policies_user
  ON public.budget_policies (tenant_id, user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scheduled_jobs_budget_paused
  ON public.scheduled_jobs (tenant_id, budget_paused);

ALTER TABLE public.cost_events
  VALIDATE CONSTRAINT cost_events_user_id_users_id_fk;

ALTER TABLE public.budget_policies
  VALIDATE CONSTRAINT budget_policies_user_id_users_id_fk;

ALTER TABLE public.budget_policies
  VALIDATE CONSTRAINT budget_policies_scope_check;

ALTER TABLE public.budget_policies
  VALIDATE CONSTRAINT budget_policies_scope_shape_check;

SELECT pg_advisory_unlock(hashtext('migration:0148_user_cost_attribution'));

RESET statement_timeout;
RESET lock_timeout;
