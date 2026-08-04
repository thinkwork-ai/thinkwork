-- THINK-585 U6 (KTD3): per-agent AgentCore Runtime dispatch flag.
-- When true AND the stage kill-switch (AGENTCORE_RUNTIME_DISPATCH_ENABLED
-- runtime-config key) is on, chat turns dispatch through the
-- agentcore-runtime-dispatch Lambda to the Bedrock AgentCore Runtime with a
-- per-thread session instead of the Pi Lambda. Additive + default false —
-- safe to apply ahead of code deploy.
--
-- Hand-rolled (drizzle meta journal is not in use for this change);
-- apply with: psql "$DATABASE_URL" -f drizzle/0283_agents_agentcore_runtime_dispatch.sql
-- creates-column: public.agents.agentcore_runtime_dispatch

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS agentcore_runtime_dispatch boolean NOT NULL DEFAULT false;
