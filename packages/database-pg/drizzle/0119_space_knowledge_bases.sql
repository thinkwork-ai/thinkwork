-- Purpose: add Space-to-knowledge-base assignments for the admin Space Memory tab.
-- Plan: docs/plans/2026-05-21-005-feat-admin-space-studio-simplification-plan.md (U3)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0119_space_knowledge_bases.sql
-- creates: public.space_knowledge_bases
-- creates: public.uq_space_kb
-- creates: public.idx_space_kbs_space
-- creates: public.idx_space_kbs_knowledge_base
-- creates-trigger: public.space_knowledge_bases.space_knowledge_bases_tenant_guard
-- creates-constraint: public.space_knowledge_bases.space_knowledge_bases_tenant_id_tenants_id_fk
-- creates-constraint: public.space_knowledge_bases.space_knowledge_bases_space_id_spaces_id_fk
-- creates-constraint: public.space_knowledge_bases.space_knowledge_bases_knowledge_base_id_knowledge_bases_id_fk

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS public.space_knowledge_bases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  space_id uuid NOT NULL,
  knowledge_base_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  search_config jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT space_knowledge_bases_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT space_knowledge_bases_space_id_spaces_id_fk
    FOREIGN KEY (space_id)
    REFERENCES public.spaces(id)
    ON DELETE CASCADE,
  CONSTRAINT space_knowledge_bases_knowledge_base_id_knowledge_bases_id_fk
    FOREIGN KEY (knowledge_base_id)
    REFERENCES public.knowledge_bases(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_space_kb
  ON public.space_knowledge_bases (space_id, knowledge_base_id);

CREATE INDEX IF NOT EXISTS idx_space_kbs_space
  ON public.space_knowledge_bases (tenant_id, space_id);

CREATE INDEX IF NOT EXISTS idx_space_kbs_knowledge_base
  ON public.space_knowledge_bases (tenant_id, knowledge_base_id);

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
  ELSIF TG_TABLE_NAME = 'space_knowledge_bases' THEN
    SELECT tenant_id INTO target_tenant_id
    FROM public.knowledge_bases
    WHERE id = NEW.knowledge_base_id;

    IF target_tenant_id IS NULL OR target_tenant_id <> NEW.tenant_id THEN
      RAISE EXCEPTION 'space knowledge base tenant mismatch for knowledge base %', NEW.knowledge_base_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS space_knowledge_bases_tenant_guard
  ON public.space_knowledge_bases;

CREATE TRIGGER space_knowledge_bases_tenant_guard
  BEFORE INSERT OR UPDATE
  ON public.space_knowledge_bases
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_space_child_tenant();

COMMIT;
