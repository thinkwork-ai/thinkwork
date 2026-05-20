-- Purpose: recast Spaces as contextual workrooms with context/tool/MCP policy surfaces.
-- Plan: docs/plans/2026-05-20-003-spaces-as-agent-contextual-workrooms-template-removal-plan.md (U3)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0112_recast_spaces_as_contextual_workrooms.sql
-- creates-column: public.spaces.icon
-- creates-column: public.spaces.category
-- creates-column: public.spaces.context_config
-- creates-column: public.spaces.connected_data_config
-- creates-column: public.spaces.tool_policy
-- creates-column: public.spaces.mcp_policy
-- creates-column: public.spaces.agent_availability_policy
-- creates-column: public.spaces.trigger_config
-- creates-column: public.spaces.render_diagnostics
-- creates: public.space_mcp_servers
-- creates: public.uq_space_mcp_servers
-- creates: public.idx_space_mcp_servers_space
-- creates: public.idx_space_mcp_servers_server
-- creates-trigger: public.space_mcp_servers.space_mcp_servers_tenant_guard
-- creates-constraint: public.space_mcp_servers.space_mcp_servers_tenant_id_tenants_id_fk
-- creates-constraint: public.space_mcp_servers.space_mcp_servers_space_id_spaces_id_fk
-- creates-constraint: public.space_mcp_servers.space_mcp_servers_mcp_server_id_tenant_mcp_servers_id_fk

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.spaces
  ADD COLUMN IF NOT EXISTS icon text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS context_config jsonb,
  ADD COLUMN IF NOT EXISTS connected_data_config jsonb,
  ADD COLUMN IF NOT EXISTS tool_policy jsonb,
  ADD COLUMN IF NOT EXISTS mcp_policy jsonb,
  ADD COLUMN IF NOT EXISTS agent_availability_policy jsonb,
  ADD COLUMN IF NOT EXISTS trigger_config jsonb,
  ADD COLUMN IF NOT EXISTS render_diagnostics jsonb;

CREATE TABLE IF NOT EXISTS public.space_mcp_servers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  space_id uuid NOT NULL,
  mcp_server_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  config jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT space_mcp_servers_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT space_mcp_servers_space_id_spaces_id_fk
    FOREIGN KEY (space_id)
    REFERENCES public.spaces(id)
    ON DELETE CASCADE,
  CONSTRAINT space_mcp_servers_mcp_server_id_tenant_mcp_servers_id_fk
    FOREIGN KEY (mcp_server_id)
    REFERENCES public.tenant_mcp_servers(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_space_mcp_servers
  ON public.space_mcp_servers (space_id, mcp_server_id);

CREATE INDEX IF NOT EXISTS idx_space_mcp_servers_space
  ON public.space_mcp_servers (tenant_id, space_id);

CREATE INDEX IF NOT EXISTS idx_space_mcp_servers_server
  ON public.space_mcp_servers (tenant_id, mcp_server_id);

CREATE OR REPLACE FUNCTION public.enforce_space_child_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_tenant_id uuid;
BEGIN
  SELECT tenant_id INTO target_tenant_id
  FROM public.spaces
  WHERE id = NEW.space_id;

  IF target_tenant_id IS NULL OR target_tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'space child tenant mismatch for space %', NEW.space_id
      USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'space_members' THEN
    SELECT tenant_id INTO target_tenant_id
    FROM public.users
    WHERE id = NEW.user_id;

    IF target_tenant_id IS NULL OR target_tenant_id <> NEW.tenant_id THEN
      RAISE EXCEPTION 'space member tenant mismatch for user %', NEW.user_id
        USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'space_agent_assignments' THEN
    SELECT tenant_id INTO target_tenant_id
    FROM public.agents
    WHERE id = NEW.agent_id;

    IF target_tenant_id IS NULL OR target_tenant_id <> NEW.tenant_id THEN
      RAISE EXCEPTION 'space agent assignment tenant mismatch for agent %', NEW.agent_id
        USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'space_checklist_items' THEN
    SELECT tenant_id INTO target_tenant_id
    FROM public.space_checklist_templates
    WHERE id = NEW.template_id;

    IF target_tenant_id IS NULL OR target_tenant_id <> NEW.tenant_id THEN
      RAISE EXCEPTION 'space checklist item tenant mismatch for template %', NEW.template_id
        USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'space_mcp_servers' THEN
    SELECT tenant_id INTO target_tenant_id
    FROM public.tenant_mcp_servers
    WHERE id = NEW.mcp_server_id;

    IF target_tenant_id IS NULL OR target_tenant_id <> NEW.tenant_id THEN
      RAISE EXCEPTION 'space MCP server tenant mismatch for MCP server %', NEW.mcp_server_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS space_mcp_servers_tenant_guard
  ON public.space_mcp_servers;

CREATE TRIGGER space_mcp_servers_tenant_guard
  BEFORE INSERT OR UPDATE
  ON public.space_mcp_servers
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_space_child_tenant();

COMMIT;
