-- Rollback for 0125_drop_space_agent_assignments.sql.
--
-- Recreates the table shape that existed before U1b. This rollback restores
-- schema compatibility only; it does not reconstruct dropped assignment rows.
--
-- creates: public.space_agent_assignments
-- creates: public.uq_space_agent_assignments_agent
-- creates: public.idx_space_agent_assignments_agent
-- creates: public.idx_space_agent_assignments_space
-- creates-trigger: public.space_agent_assignments.space_agent_assignments_tenant_guard
-- creates-constraint: public.space_agent_assignments.space_agent_assignments_tenant_id_tenants_id_fk
-- creates-constraint: public.space_agent_assignments.space_agent_assignments_space_id_spaces_id_fk
-- creates-constraint: public.space_agent_assignments.space_agent_assignments_agent_id_agents_id_fk
-- creates-constraint: public.space_agent_assignments.space_agent_assignments_status_allowed

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS public.space_agent_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  space_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  local_role text,
  local_instructions text,
  auto_subscribe boolean NOT NULL DEFAULT true,
  allowed_capabilities jsonb,
  allowed_tools jsonb,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT space_agent_assignments_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT space_agent_assignments_space_id_spaces_id_fk
    FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE CASCADE,
  CONSTRAINT space_agent_assignments_agent_id_agents_id_fk
    FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE,
  CONSTRAINT space_agent_assignments_status_allowed
    CHECK (status IN ('active','paused','archived'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_space_agent_assignments_agent
  ON public.space_agent_assignments (tenant_id, space_id, agent_id);

CREATE INDEX IF NOT EXISTS idx_space_agent_assignments_agent
  ON public.space_agent_assignments (tenant_id, agent_id);

CREATE INDEX IF NOT EXISTS idx_space_agent_assignments_space
  ON public.space_agent_assignments (space_id);

DROP TRIGGER IF EXISTS space_agent_assignments_tenant_guard
  ON public.space_agent_assignments;

CREATE TRIGGER space_agent_assignments_tenant_guard
  BEFORE INSERT OR UPDATE
  ON public.space_agent_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_space_child_tenant();

COMMIT;
