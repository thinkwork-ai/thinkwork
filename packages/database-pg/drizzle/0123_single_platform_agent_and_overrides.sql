-- Purpose: add the single-platform-agent marker and typed per-Space runtime override columns.
-- Plan: docs/plans/2026-05-22-005-refactor-single-platform-agent-and-space-runtime-overrides-plan.md (U1a)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0123_single_platform_agent_and_overrides.sql
-- creates-column: public.agents.is_platform_default
-- creates: public.uq_agents_platform_default_per_tenant
-- creates-column: public.spaces.model_override
-- creates-column: public.spaces.guardrail_id_override
-- creates-column: public.spaces.budget_monthly_cents_override
-- creates-column: public.spaces.budget_paused_override
-- creates-column: public.spaces.sandbox_override
-- creates-constraint: public.spaces.spaces_guardrail_id_override_guardrails_id_fk

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS is_platform_default boolean;

UPDATE public.agents
SET is_platform_default = false
WHERE is_platform_default IS NULL;

ALTER TABLE public.agents
  ALTER COLUMN is_platform_default SET DEFAULT false,
  ALTER COLUMN is_platform_default SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_agents_platform_default_per_tenant
  ON public.agents (tenant_id)
  WHERE is_platform_default IS TRUE;

ALTER TABLE public.spaces
  ADD COLUMN IF NOT EXISTS model_override text,
  ADD COLUMN IF NOT EXISTS guardrail_id_override uuid,
  ADD COLUMN IF NOT EXISTS budget_monthly_cents_override integer,
  ADD COLUMN IF NOT EXISTS budget_paused_override boolean,
  ADD COLUMN IF NOT EXISTS sandbox_override boolean;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'spaces_guardrail_id_override_guardrails_id_fk'
      AND conrelid = 'public.spaces'::regclass
  ) THEN
    ALTER TABLE public.spaces
      ADD CONSTRAINT spaces_guardrail_id_override_guardrails_id_fk
      FOREIGN KEY (guardrail_id_override)
      REFERENCES public.guardrails(id);
  END IF;
END;
$$;

COMMIT;
