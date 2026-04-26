-- 0041_activation_automation_candidates.sql
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0041_activation_automation_candidates.sql
-- Then verify:
--   pnpm db:migrate-manual
--
-- creates: public.activation_automation_candidates
-- creates: public.idx_activation_automation_candidates_session
-- creates: public.idx_activation_automation_candidates_user_status
-- creates: public.uq_activation_automation_candidates_active_duplicate

DO $$
BEGIN
  IF to_regclass('public.activation_sessions') IS NULL THEN
    RAISE EXCEPTION '0041: expected public.activation_sessions to exist before automation candidates';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.activation_automation_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.activation_sessions(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  source_layer text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  why_suggested text,
  target_type text NOT NULL DEFAULT 'agent',
  target_agent_id uuid REFERENCES public.agents(id),
  trigger_type text NOT NULL DEFAULT 'agent_scheduled',
  schedule_type text NOT NULL DEFAULT 'cron',
  schedule_expression text NOT NULL,
  timezone text NOT NULL DEFAULT 'UTC',
  prompt text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'generated',
  cost_estimate jsonb NOT NULL DEFAULT '{}'::jsonb,
  disclosure_version text NOT NULL DEFAULT 'activation-automation-v1',
  duplicate_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'activation_automation_candidates_status_allowed'
      AND conrelid = 'public.activation_automation_candidates'::regclass
  ) THEN
    ALTER TABLE public.activation_automation_candidates
      ADD CONSTRAINT activation_automation_candidates_status_allowed
      CHECK (status IN (
        'generated',
        'deferred',
        'dismissed'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'activation_automation_candidates_target_allowed'
      AND conrelid = 'public.activation_automation_candidates'::regclass
  ) THEN
    ALTER TABLE public.activation_automation_candidates
      ADD CONSTRAINT activation_automation_candidates_target_allowed
      CHECK (target_type = 'agent');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_activation_automation_candidates_session
  ON public.activation_automation_candidates (session_id);

CREATE INDEX IF NOT EXISTS idx_activation_automation_candidates_user_status
  ON public.activation_automation_candidates (tenant_id, user_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_activation_automation_candidates_active_duplicate
  ON public.activation_automation_candidates (tenant_id, user_id, duplicate_key)
  WHERE status = 'generated';
