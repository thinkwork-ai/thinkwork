-- Agent runtime selector for parallel AgentCore runtimes.
--
-- Plan:
--   docs/plans/2026-04-26-009-feat-pi-agent-runtime-parallel-substrate-plan.md
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0042_agent_runtime_selector.sql
--
-- creates-column: public.agents.runtime
-- creates-column: public.agent_templates.runtime
-- creates-constraint: public.agents.agents_runtime_check
-- creates-constraint: public.agent_templates.agent_templates_runtime_check

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS runtime text NOT NULL DEFAULT 'strands';

ALTER TABLE public.agent_templates
  ADD COLUMN IF NOT EXISTS runtime text NOT NULL DEFAULT 'strands';

ALTER TABLE public.agents
  DROP CONSTRAINT IF EXISTS agents_runtime_check;

ALTER TABLE public.agents
  ADD CONSTRAINT agents_runtime_check
  CHECK (runtime IN ('strands', 'pi'));

ALTER TABLE public.agent_templates
  DROP CONSTRAINT IF EXISTS agent_templates_runtime_check;

ALTER TABLE public.agent_templates
  ADD CONSTRAINT agent_templates_runtime_check
  CHECK (runtime IN ('strands', 'pi'));

COMMIT;
