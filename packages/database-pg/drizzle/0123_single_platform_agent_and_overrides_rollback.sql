-- Rollback for 0123_single_platform_agent_and_overrides.sql.
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0123_single_platform_agent_and_overrides_rollback.sql

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.spaces
  DROP CONSTRAINT IF EXISTS spaces_guardrail_id_override_guardrails_id_fk,
  DROP COLUMN IF EXISTS sandbox_override,
  DROP COLUMN IF EXISTS budget_paused_override,
  DROP COLUMN IF EXISTS budget_monthly_cents_override,
  DROP COLUMN IF EXISTS guardrail_id_override,
  DROP COLUMN IF EXISTS model_override;

DROP INDEX IF EXISTS public.uq_agents_platform_default_per_tenant;

ALTER TABLE public.agents
  DROP COLUMN IF EXISTS is_platform_default;

COMMIT;
