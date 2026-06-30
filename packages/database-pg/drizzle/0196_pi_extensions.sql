-- Dynamic Pi extension registry and assignments.
-- creates: public.pi_extension_sources
-- creates: public.pi_extension_versions
-- creates: public.pi_extension_assignments
-- creates: public.uq_pi_extension_sources_tenant_repository
-- creates: public.uq_pi_extension_versions_source_commit
-- creates: public.uq_pi_extension_assignments_default_version
-- creates: public.uq_pi_extension_assignments_profile_version
-- creates: public.idx_pi_extension_sources_tenant
-- creates: public.idx_pi_extension_versions_tenant_status
-- creates: public.idx_pi_extension_versions_source
-- creates: public.idx_pi_extension_assignments_tenant_target
-- creates: public.idx_pi_extension_assignments_version
-- creates-constraint: public.pi_extension_sources.pi_extension_sources_source_type_check
-- creates-constraint: public.pi_extension_versions.pi_extension_versions_status_check
-- creates-constraint: public.pi_extension_assignments.pi_extension_assignments_target_type_check
-- creates-constraint: public.pi_extension_assignments.pi_extension_assignments_profile_target_check

CREATE TABLE IF NOT EXISTS public.pi_extension_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_type text NOT NULL DEFAULT 'github',
  repository_url text NOT NULL,
  repository_owner text,
  repository_name text,
  display_name text,
  created_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pi_extension_sources_source_type_check
    CHECK (source_type IN ('github'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pi_extension_sources_tenant_repository
  ON public.pi_extension_sources (tenant_id, source_type, repository_url);

CREATE INDEX IF NOT EXISTS idx_pi_extension_sources_tenant
  ON public.pi_extension_sources (tenant_id);

CREATE TABLE IF NOT EXISTS public.pi_extension_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES public.pi_extension_sources(id) ON DELETE CASCADE,
  display_name text,
  description text,
  source_ref text NOT NULL,
  commit_sha text,
  manifest_hash text,
  artifact_hash text,
  artifact_uri text,
  runtime_target text,
  status text NOT NULL DEFAULT 'imported',
  status_reason text,
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  tool_names text[] NOT NULL DEFAULT ARRAY[]::text[],
  lifecycle_hooks text[] NOT NULL DEFAULT ARRAY[]::text[],
  permission_classes text[] NOT NULL DEFAULT ARRAY[]::text[],
  verification_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  approved_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  rejected_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  rejected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pi_extension_versions_status_check
    CHECK (status IN (
      'imported',
      'needs_review',
      'approved',
      'rejected',
      'failed_verification'
    ))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pi_extension_versions_source_commit
  ON public.pi_extension_versions (tenant_id, source_id, commit_sha);

CREATE INDEX IF NOT EXISTS idx_pi_extension_versions_tenant_status
  ON public.pi_extension_versions (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_pi_extension_versions_source
  ON public.pi_extension_versions (source_id);

CREATE TABLE IF NOT EXISTS public.pi_extension_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES public.pi_extension_versions(id) ON DELETE CASCADE,
  target_type text NOT NULL,
  agent_profile_id uuid REFERENCES public.agent_profiles(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  granted_permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  assigned_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pi_extension_assignments_target_type_check
    CHECK (target_type IN ('default_agent', 'agent_profile')),
  CONSTRAINT pi_extension_assignments_profile_target_check
    CHECK (
      (target_type = 'agent_profile' AND agent_profile_id IS NOT NULL)
      OR (target_type = 'default_agent' AND agent_profile_id IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pi_extension_assignments_default_version
  ON public.pi_extension_assignments (tenant_id, version_id)
  WHERE target_type = 'default_agent';

CREATE UNIQUE INDEX IF NOT EXISTS uq_pi_extension_assignments_profile_version
  ON public.pi_extension_assignments (tenant_id, agent_profile_id, version_id)
  WHERE target_type = 'agent_profile';

CREATE INDEX IF NOT EXISTS idx_pi_extension_assignments_tenant_target
  ON public.pi_extension_assignments (tenant_id, target_type, agent_profile_id);

CREATE INDEX IF NOT EXISTS idx_pi_extension_assignments_version
  ON public.pi_extension_assignments (version_id);
