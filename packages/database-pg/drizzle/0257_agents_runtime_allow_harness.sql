-- THINK-311 (AgentCore trial): loosen the agents.runtime CHECK constraint
-- so the Agent-configuration Runtime dropdown can persist the internal
-- 'harness' value (surfaced to users as "AgentCore"). Without this, the
-- updateTenantAgent mutation dies on agents_runtime_check and the UI
-- shows "[GraphQL] Unexpected error.".
--
-- Hand-rolled (NOT registered in meta/_journal.json) — apply via psql:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0257_agents_runtime_allow_harness.sql
-- Already applied to dev via RDS Data API on 2026-07-16.
--
-- agent_templates.runtime intentionally untouched: the AgentCore trial is
-- scoped to the ONE platform agent per tenant; no template carries it.
--
-- Marker for the db:migrate-manual drift-reporter:
-- creates-constraint: public.agents.agents_runtime_check

\echo '== THINK-311: allow harness in agents_runtime_check =='

ALTER TABLE agents
  DROP CONSTRAINT IF EXISTS agents_runtime_check;

ALTER TABLE agents
  ADD CONSTRAINT agents_runtime_check
  CHECK (runtime IN ('strands', 'flue', 'pi', 'harness'));
