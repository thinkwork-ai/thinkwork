-- Purpose: add tenant-global Agent Profiles for Pi subagent delegation.
-- Plan: docs/plans/2026-06-07-002-feat-agent-profiles-pi-subagents-plan.md U1
-- Apply manually (no CI migration runner):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0152_agent_profiles.sql
-- creates: public.agent_profiles
-- creates: public.agent_profile_space_assignments
-- creates: public.uq_agent_profiles_tenant_slug
-- creates: public.uq_agent_profiles_tenant_built_in_key
-- creates: public.idx_agent_profiles_tenant_enabled
-- creates: public.uq_agent_profile_space_assignments
-- creates: public.idx_agent_profile_space_assignments_space
-- creates-constraint: public.agent_profiles.agent_profiles_tenant_id_tenants_id_fk
-- creates-constraint: public.agent_profile_space_assignments.agent_profile_space_assignments_profile_id_agent_profiles_id_fk
-- creates-constraint: public.agent_profile_space_assignments.agent_profile_space_assignments_tenant_id_tenants_id_fk
-- creates-constraint: public.agent_profile_space_assignments.agent_profile_space_assignments_space_id_spaces_id_fk

\set ON_ERROR_STOP on

SET lock_timeout = '5s';
SET statement_timeout = '15min';

SELECT pg_advisory_lock(hashtext('migration:0152_agent_profiles'));

CREATE TABLE IF NOT EXISTS public.agent_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  slug text NOT NULL,
  name text NOT NULL,
  description text,
  routing_guidance text,
  instructions text NOT NULL DEFAULT '',
  model_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  built_in_key text,
  tool_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  skill_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  execution_controls jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_profiles_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_profiles_tenant_slug
  ON public.agent_profiles (tenant_id, slug);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_profiles_tenant_built_in_key
  ON public.agent_profiles (tenant_id, built_in_key)
  WHERE built_in_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_profiles_tenant_enabled
  ON public.agent_profiles (tenant_id, enabled);

CREATE TABLE IF NOT EXISTS public.agent_profile_space_assignments (
  profile_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  space_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_profile_space_assignments_profile_id_agent_profiles_id_fk
    FOREIGN KEY (profile_id)
    REFERENCES public.agent_profiles(id)
    ON DELETE CASCADE,
  CONSTRAINT agent_profile_space_assignments_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT agent_profile_space_assignments_space_id_spaces_id_fk
    FOREIGN KEY (space_id)
    REFERENCES public.spaces(id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_profile_space_assignments
  ON public.agent_profile_space_assignments (profile_id, space_id);

CREATE INDEX IF NOT EXISTS idx_agent_profile_space_assignments_space
  ON public.agent_profile_space_assignments (tenant_id, space_id);

SELECT pg_advisory_unlock(hashtext('migration:0152_agent_profiles'));
