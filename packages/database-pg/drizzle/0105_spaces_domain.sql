-- Purpose: add tenant-scoped Spaces for collaborative onboarding workflows.
-- Plan: docs/plans/2026-05-19-003-feat-spaces-customer-onboarding-v1-plan.md (U2)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0105_spaces_domain.sql
-- creates: public.spaces
-- creates: public.space_members
-- creates: public.space_agent_assignments
-- creates: public.space_checklist_templates
-- creates: public.space_checklist_items
-- creates: public.space_integrations
-- creates: public.uq_spaces_tenant_slug
-- creates: public.idx_spaces_tenant_status
-- creates: public.idx_spaces_tenant_template
-- creates: public.uq_space_members_user
-- creates: public.idx_space_members_tenant_user
-- creates: public.idx_space_members_space
-- creates: public.uq_space_agent_assignments_agent
-- creates: public.idx_space_agent_assignments_agent
-- creates: public.idx_space_agent_assignments_space
-- creates: public.uq_space_checklist_templates_key
-- creates: public.idx_space_checklist_templates_space
-- creates: public.uq_space_checklist_items_key
-- creates: public.idx_space_checklist_items_template
-- creates: public.idx_space_checklist_items_space
-- creates: public.uq_space_integrations_provider
-- creates: public.idx_space_integrations_space
-- creates-function: public.enforce_space_child_tenant
-- creates-trigger: public.space_members.space_members_tenant_guard
-- creates-trigger: public.space_agent_assignments.space_agent_assignments_tenant_guard
-- creates-trigger: public.space_checklist_templates.space_checklist_templates_tenant_guard
-- creates-trigger: public.space_checklist_items.space_checklist_items_tenant_guard
-- creates-trigger: public.space_integrations.space_integrations_tenant_guard
-- creates-constraint: public.spaces.spaces_tenant_id_tenants_id_fk
-- creates-constraint: public.spaces.spaces_status_allowed
-- creates-constraint: public.spaces.spaces_kind_allowed
-- creates-constraint: public.space_members.space_members_tenant_id_tenants_id_fk
-- creates-constraint: public.space_members.space_members_space_id_spaces_id_fk
-- creates-constraint: public.space_members.space_members_user_id_users_id_fk
-- creates-constraint: public.space_members.space_members_role_allowed
-- creates-constraint: public.space_members.space_members_notification_preference_allowed
-- creates-constraint: public.space_agent_assignments.space_agent_assignments_tenant_id_tenants_id_fk
-- creates-constraint: public.space_agent_assignments.space_agent_assignments_space_id_spaces_id_fk
-- creates-constraint: public.space_agent_assignments.space_agent_assignments_agent_id_agents_id_fk
-- creates-constraint: public.space_agent_assignments.space_agent_assignments_status_allowed
-- creates-constraint: public.space_checklist_templates.space_checklist_templates_tenant_id_tenants_id_fk
-- creates-constraint: public.space_checklist_templates.space_checklist_templates_space_id_spaces_id_fk
-- creates-constraint: public.space_checklist_items.space_checklist_items_tenant_id_tenants_id_fk
-- creates-constraint: public.space_checklist_items.space_checklist_items_space_id_spaces_id_fk
-- creates-constraint: public.space_checklist_items.space_checklist_items_template_id_space_checklist_templates_id_fk
-- creates-constraint: public.space_integrations.space_integrations_tenant_id_tenants_id_fk
-- creates-constraint: public.space_integrations.space_integrations_space_id_spaces_id_fk
-- creates-constraint: public.space_integrations.space_integrations_provider_allowed
-- creates-constraint: public.space_integrations.space_integrations_status_allowed
-- creates-constraint: public.space_integrations.space_integrations_writeback_policy_allowed

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS public.spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  slug text NOT NULL,
  name text NOT NULL,
  description text,
  prompt text,
  status text NOT NULL DEFAULT 'active',
  kind text NOT NULL DEFAULT 'custom',
  template_key text,
  config jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spaces_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT spaces_status_allowed
    CHECK (status IN ('active', 'archived')),
  CONSTRAINT spaces_kind_allowed
    CHECK (kind IN ('custom', 'customer_onboarding'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_spaces_tenant_slug
  ON public.spaces (tenant_id, slug);

CREATE INDEX IF NOT EXISTS idx_spaces_tenant_status
  ON public.spaces (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_spaces_tenant_template
  ON public.spaces (tenant_id, template_key);

CREATE TABLE IF NOT EXISTS public.space_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  space_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'member',
  notification_preference text NOT NULL DEFAULT 'subscribed',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT space_members_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT space_members_space_id_spaces_id_fk
    FOREIGN KEY (space_id)
    REFERENCES public.spaces(id)
    ON DELETE CASCADE,
  CONSTRAINT space_members_user_id_users_id_fk
    FOREIGN KEY (user_id)
    REFERENCES public.users(id)
    ON DELETE CASCADE,
  CONSTRAINT space_members_role_allowed
    CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  CONSTRAINT space_members_notification_preference_allowed
    CHECK (notification_preference IN ('subscribed', 'mentions', 'muted'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_space_members_user
  ON public.space_members (tenant_id, space_id, user_id);

CREATE INDEX IF NOT EXISTS idx_space_members_tenant_user
  ON public.space_members (tenant_id, user_id);

CREATE INDEX IF NOT EXISTS idx_space_members_space
  ON public.space_members (space_id);

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
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT space_agent_assignments_space_id_spaces_id_fk
    FOREIGN KEY (space_id)
    REFERENCES public.spaces(id)
    ON DELETE CASCADE,
  CONSTRAINT space_agent_assignments_agent_id_agents_id_fk
    FOREIGN KEY (agent_id)
    REFERENCES public.agents(id)
    ON DELETE CASCADE,
  CONSTRAINT space_agent_assignments_status_allowed
    CHECK (status IN ('active', 'paused', 'archived'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_space_agent_assignments_agent
  ON public.space_agent_assignments (tenant_id, space_id, agent_id);

CREATE INDEX IF NOT EXISTS idx_space_agent_assignments_agent
  ON public.space_agent_assignments (tenant_id, agent_id);

CREATE INDEX IF NOT EXISTS idx_space_agent_assignments_space
  ON public.space_agent_assignments (space_id);

CREATE TABLE IF NOT EXISTS public.space_checklist_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  space_id uuid NOT NULL,
  key text NOT NULL,
  name text NOT NULL,
  description text,
  config jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT space_checklist_templates_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT space_checklist_templates_space_id_spaces_id_fk
    FOREIGN KEY (space_id)
    REFERENCES public.spaces(id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_space_checklist_templates_key
  ON public.space_checklist_templates (tenant_id, space_id, key);

CREATE INDEX IF NOT EXISTS idx_space_checklist_templates_space
  ON public.space_checklist_templates (space_id);

CREATE TABLE IF NOT EXISTS public.space_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  space_id uuid NOT NULL,
  template_id uuid NOT NULL,
  key text NOT NULL,
  title text NOT NULL,
  description text,
  role_key text,
  required boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  external_task_template jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT space_checklist_items_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT space_checklist_items_space_id_spaces_id_fk
    FOREIGN KEY (space_id)
    REFERENCES public.spaces(id)
    ON DELETE CASCADE,
  CONSTRAINT space_checklist_items_template_id_space_checklist_templates_id_fk
    FOREIGN KEY (template_id)
    REFERENCES public.space_checklist_templates(id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_space_checklist_items_key
  ON public.space_checklist_items (tenant_id, template_id, key);

CREATE INDEX IF NOT EXISTS idx_space_checklist_items_template
  ON public.space_checklist_items (template_id);

CREATE INDEX IF NOT EXISTS idx_space_checklist_items_space
  ON public.space_checklist_items (space_id);

CREATE TABLE IF NOT EXISTS public.space_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  space_id uuid NOT NULL,
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  writeback_policy text NOT NULL DEFAULT 'disabled',
  config jsonb,
  webhook_config_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT space_integrations_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT space_integrations_space_id_spaces_id_fk
    FOREIGN KEY (space_id)
    REFERENCES public.spaces(id)
    ON DELETE CASCADE,
  CONSTRAINT space_integrations_provider_allowed
    CHECK (provider IN ('lastmile_tasks', 'webhook')),
  CONSTRAINT space_integrations_status_allowed
    CHECK (status IN ('active', 'paused', 'archived')),
  CONSTRAINT space_integrations_writeback_policy_allowed
    CHECK (writeback_policy IN ('disabled', 'status_only', 'status_and_comments'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_space_integrations_provider
  ON public.space_integrations (tenant_id, space_id, provider);

CREATE INDEX IF NOT EXISTS idx_space_integrations_space
  ON public.space_integrations (space_id);

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
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS space_members_tenant_guard
  ON public.space_members;

CREATE TRIGGER space_members_tenant_guard
  BEFORE INSERT OR UPDATE
  ON public.space_members
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_space_child_tenant();

DROP TRIGGER IF EXISTS space_agent_assignments_tenant_guard
  ON public.space_agent_assignments;

CREATE TRIGGER space_agent_assignments_tenant_guard
  BEFORE INSERT OR UPDATE
  ON public.space_agent_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_space_child_tenant();

DROP TRIGGER IF EXISTS space_checklist_templates_tenant_guard
  ON public.space_checklist_templates;

CREATE TRIGGER space_checklist_templates_tenant_guard
  BEFORE INSERT OR UPDATE
  ON public.space_checklist_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_space_child_tenant();

DROP TRIGGER IF EXISTS space_checklist_items_tenant_guard
  ON public.space_checklist_items;

CREATE TRIGGER space_checklist_items_tenant_guard
  BEFORE INSERT OR UPDATE
  ON public.space_checklist_items
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_space_child_tenant();

DROP TRIGGER IF EXISTS space_integrations_tenant_guard
  ON public.space_integrations;

CREATE TRIGGER space_integrations_tenant_guard
  BEFORE INSERT OR UPDATE
  ON public.space_integrations
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_space_child_tenant();

COMMIT;
