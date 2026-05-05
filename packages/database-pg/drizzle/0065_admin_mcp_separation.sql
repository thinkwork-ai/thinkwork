-- Admin MCP separation — registry split + agent_templates.is_admin flag.
--
-- Move admin-class MCP servers (admin-ops control plane) out of
-- `tenant_mcp_servers` (which holds user-facing connectors) into a
-- dedicated `admin_mcp_servers` registry that can only attach to
-- agent templates flagged is_admin = true.
--
-- This migration creates the new tables and the flag. It does NOT
-- migrate existing tenant_mcp_servers.admin-ops rows — that's a later
-- unit (U6) once the runtime resolver and provisioning paths are
-- wired through both registries.
--
-- Plan:
--   docs/plans/2026-05-05-001-refactor-admin-ops-mcp-separation-plan.md
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0065_admin_mcp_separation.sql
--
-- creates-column: public.agent_templates.is_admin
-- creates: public.agent_templates_is_admin_one_way
-- creates: public.admin_mcp_servers
-- creates: public.admin_mcp_servers_status_enum
-- creates: public.uq_admin_mcp_servers_slug
-- creates: public.idx_admin_mcp_servers_tenant
-- creates: public.agent_admin_mcp_servers
-- creates: public.uq_agent_admin_mcp_servers
-- creates: public.idx_agent_admin_mcp_servers_agent
-- creates: public.agent_template_admin_mcp_servers
-- creates: public.uq_agent_template_admin_mcp_servers
-- creates: public.idx_agent_template_admin_mcp_servers_template

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ----------------------------------------------------------------------
-- agent_templates.is_admin — one-way-door admin-class flag
-- ----------------------------------------------------------------------

ALTER TABLE public.agent_templates
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

-- One-way door: a template can be promoted to admin-class but never
-- demoted. This is enforced at the row level via a trigger because
-- a CHECK constraint cannot reference OLD/NEW.
CREATE OR REPLACE FUNCTION public.enforce_agent_templates_is_admin_one_way()
RETURNS trigger AS $$
BEGIN
  IF OLD.is_admin = true AND NEW.is_admin = false THEN
    RAISE EXCEPTION 'agent_templates.is_admin is a one-way door: cannot demote from true to false (template id = %)', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agent_templates_is_admin_one_way
  ON public.agent_templates;

CREATE TRIGGER agent_templates_is_admin_one_way
  BEFORE UPDATE OF is_admin ON public.agent_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_agent_templates_is_admin_one_way();

-- ----------------------------------------------------------------------
-- admin_mcp_servers — tenant-scoped admin-only MCP registry
-- ----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.admin_mcp_servers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  name text NOT NULL,
  slug text NOT NULL,
  url text NOT NULL,
  transport text NOT NULL DEFAULT 'streamable-http',
  auth_type text NOT NULL DEFAULT 'none',
  auth_config jsonb,
  oauth_provider text,
  tools jsonb,
  enabled boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'approved',
  url_hash text,
  approved_by uuid,
  approved_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT admin_mcp_servers_status_enum CHECK (
    status IN ('pending', 'approved', 'rejected')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_mcp_servers_slug
  ON public.admin_mcp_servers (tenant_id, slug);

CREATE INDEX IF NOT EXISTS idx_admin_mcp_servers_tenant
  ON public.admin_mcp_servers (tenant_id);

-- ----------------------------------------------------------------------
-- agent_admin_mcp_servers — per-agent admin-MCP enablement
-- ----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agent_admin_mcp_servers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  agent_id uuid NOT NULL REFERENCES public.agents(id),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  mcp_server_id uuid NOT NULL REFERENCES public.admin_mcp_servers(id),
  enabled boolean NOT NULL DEFAULT true,
  config jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_admin_mcp_servers
  ON public.agent_admin_mcp_servers (agent_id, mcp_server_id);

CREATE INDEX IF NOT EXISTS idx_agent_admin_mcp_servers_agent
  ON public.agent_admin_mcp_servers (agent_id);

-- ----------------------------------------------------------------------
-- agent_template_admin_mcp_servers — template-level admin-MCP attach
-- ----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agent_template_admin_mcp_servers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  template_id uuid NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  mcp_server_id uuid NOT NULL REFERENCES public.admin_mcp_servers(id),
  enabled boolean NOT NULL DEFAULT true,
  config jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_template_admin_mcp_servers
  ON public.agent_template_admin_mcp_servers (template_id, mcp_server_id);

CREATE INDEX IF NOT EXISTS idx_agent_template_admin_mcp_servers_template
  ON public.agent_template_admin_mcp_servers (template_id);

COMMIT;
