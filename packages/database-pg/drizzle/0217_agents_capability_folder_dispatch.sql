-- THINK-173 U5 (R20): per-agent capability-folder migration flag.
-- When true, dispatch reads the agent's capability surface from the
-- rendered folder manifest instead of the legacy MCP tables. Flipped
-- atomically per agent by the U11 backfill after its divergence check
-- passes. Additive + default false — safe to apply ahead of code deploy.
--
-- Hand-rolled (drizzle meta journal is not in use for this change);
-- apply with: psql "$DATABASE_URL" -f drizzle/0217_agents_capability_folder_dispatch.sql
-- creates-column: public.agents.capability_folder_dispatch

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS capability_folder_dispatch boolean NOT NULL DEFAULT false;
