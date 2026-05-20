-- Purpose: move durable runtime and operational policy fields from Templates onto Agents.
-- Plan: docs/plans/2026-05-20-003-spaces-as-agent-contextual-workrooms-template-removal-plan.md (U4)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0113_agents_own_runtime_fields.sql
-- creates-column: public.agents.model
-- creates-column: public.agents.guardrail_id
-- creates-column: public.agents.blocked_tools
-- creates-column: public.agents.sandbox
-- creates-column: public.agents.browser
-- creates-column: public.agents.web_search
-- creates-column: public.agents.send_email
-- creates-column: public.agents.context_engine
-- creates-constraint: public.agents.agents_guardrail_id_guardrails_id_fk

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS guardrail_id uuid,
  ADD COLUMN IF NOT EXISTS blocked_tools jsonb,
  ADD COLUMN IF NOT EXISTS sandbox jsonb,
  ADD COLUMN IF NOT EXISTS browser jsonb,
  ADD COLUMN IF NOT EXISTS web_search jsonb DEFAULT '{"enabled": true}'::jsonb,
  ADD COLUMN IF NOT EXISTS send_email jsonb DEFAULT '{"enabled": true}'::jsonb,
  ADD COLUMN IF NOT EXISTS context_engine jsonb DEFAULT '{"enabled": true}'::jsonb,
  ALTER COLUMN template_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agents_guardrail_id_guardrails_id_fk'
      AND conrelid = 'public.agents'::regclass
  ) THEN
    ALTER TABLE public.agents
      ADD CONSTRAINT agents_guardrail_id_guardrails_id_fk
      FOREIGN KEY (guardrail_id)
      REFERENCES public.guardrails(id);
  END IF;
END
$$;

COMMIT;
