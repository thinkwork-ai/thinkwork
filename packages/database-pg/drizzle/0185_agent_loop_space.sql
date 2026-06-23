-- 0185_agent_loop_space.sql
--
-- Adds the explicit Space an Automation/AgentLoop should run in. Existing
-- loops keep falling back to the default Agent space until configured.
--
-- Manual application:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0185_agent_loop_space.sql
--
-- creates-column: public.agent_loops.space_id
-- creates: public.agent_loops_tenant_space_idx

ALTER TABLE public.agent_loops
  ADD COLUMN IF NOT EXISTS space_id uuid REFERENCES public.spaces(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS agent_loops_tenant_space_idx
  ON public.agent_loops (tenant_id, space_id);
