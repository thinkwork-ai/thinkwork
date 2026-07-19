-- Provider-neutral authentication control plane (plan 2026-07-18-001 U11).
-- creates-column: public.auth_provider_resources.connection_key
-- creates-column: public.auth_provider_resources.provider_kind
-- creates-column: public.auth_provider_resources.lifecycle_state
-- creates-column: public.auth_provider_resources.resource_arn
-- creates-column: public.auth_provider_resources.aws_account_id
-- creates-column: public.auth_provider_resources.aws_region
-- creates-column: public.auth_provider_resources.desired_revision
-- creates-column: public.tenant_auth_provider_references.desired_revision
-- creates: public.uq_auth_provider_resources_connection_key
-- creates: public.uq_tenant_auth_provider_references_tenant_resource
-- creates: public.tenant_auth_policies
-- creates: public.uq_tenant_auth_policies_tenant
-- creates-function: public.ensure_default_tenant_auth_policy
-- creates-trigger: public.tenants.trg_tenants_default_auth_policy
-- creates: public.tenant_auth_hosts
-- creates: public.uq_tenant_auth_hosts_hostname
-- creates: public.idx_tenant_auth_hosts_tenant_status
-- creates: public.auth_route_clients
-- creates: public.uq_auth_route_clients_route_family
-- creates: public.uq_auth_route_clients_app_client
-- creates: public.idx_auth_route_clients_lifecycle_status
-- creates: public.user_auth_identities
-- creates: public.uq_user_auth_identities_cognito_sub
-- creates: public.uq_user_auth_identities_provider_subject
-- creates: public.idx_user_auth_identities_user_status
-- creates: public.idx_user_auth_identities_tenant_status
-- creates: public.auth_identity_enrollments
-- creates: public.uq_auth_identity_enrollments_nonce
-- creates: public.uq_auth_identity_enrollments_challenge
-- creates: public.idx_auth_identity_enrollments_pending
-- creates: public.auth_reconciliation_sets
-- creates: public.uq_auth_reconciliation_sets_stage_revision
-- creates: public.uq_auth_reconciliation_sets_idempotency
-- creates: public.auth_cutover_runs
-- creates: public.uq_auth_cutover_runs_stage_inventory
-- creates: public.idx_auth_cutover_runs_status
-- creates: public.auth_identity_proofs
-- creates: public.uq_auth_identity_proofs_digest
-- creates: public.idx_auth_identity_proofs_identity
-- drops: public.uq_tenant_auth_provider_references_install_resource

ALTER TABLE public.auth_provider_resources
  ADD COLUMN IF NOT EXISTS connection_key text,
  ADD COLUMN IF NOT EXISTS provider_kind text,
  ADD COLUMN IF NOT EXISTS lifecycle_state text,
  ADD COLUMN IF NOT EXISTS resource_arn text,
  ADD COLUMN IF NOT EXISTS aws_account_id text,
  ADD COLUMN IF NOT EXISTS aws_region text,
  ADD COLUMN IF NOT EXISTS desired_revision integer;

UPDATE public.auth_provider_resources
SET connection_key = COALESCE(connection_key, provider_key || ':' || id::text),
    provider_kind = COALESCE(provider_kind, CASE WHEN provider_key = 'workos' THEN 'legacy_workos' ELSE provider_key END),
    lifecycle_state = COALESCE(lifecycle_state, 'coexistence'),
    desired_revision = COALESCE(desired_revision, 1);

ALTER TABLE public.auth_provider_resources
  ALTER COLUMN connection_key SET DEFAULT 'legacy',
  ALTER COLUMN connection_key SET NOT NULL,
  ALTER COLUMN provider_kind SET DEFAULT 'legacy_workos',
  ALTER COLUMN provider_kind SET NOT NULL,
  ALTER COLUMN lifecycle_state SET DEFAULT 'coexistence',
  ALTER COLUMN lifecycle_state SET NOT NULL,
  ALTER COLUMN desired_revision SET DEFAULT 1,
  ALTER COLUMN desired_revision SET NOT NULL,
  ALTER COLUMN issuer_url DROP NOT NULL,
  ALTER COLUMN client_id DROP NOT NULL,
  ALTER COLUMN client_secret_ref DROP NOT NULL;

ALTER TABLE public.auth_provider_resources
  DROP CONSTRAINT IF EXISTS auth_provider_resources_no_public_without_valid,
  DROP CONSTRAINT IF EXISTS auth_provider_resources_lifecycle_state_allowed,
  ADD CONSTRAINT auth_provider_resources_lifecycle_state_allowed
    CHECK (lifecycle_state IN ('coexistence', 'native', 'denied')),
  ADD CONSTRAINT auth_provider_resources_no_public_without_valid
    CHECK (
      public_options_published = false OR
      (validation_status IN ('valid', 'partially_valid') AND lifecycle_state <> 'denied')
    );

CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_provider_resources_connection_key
  ON public.auth_provider_resources (cognito_user_pool_id, connection_key);

ALTER TABLE public.tenant_auth_provider_references
  ADD COLUMN IF NOT EXISTS desired_revision integer;

UPDATE public.tenant_auth_provider_references
SET desired_revision = COALESCE(desired_revision, 1);

ALTER TABLE public.tenant_auth_provider_references
  ALTER COLUMN desired_revision SET DEFAULT 1,
  ALTER COLUMN desired_revision SET NOT NULL,
  ALTER COLUMN plugin_install_id DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS tenant_auth_provider_references_tenant_id_fkey,
  DROP CONSTRAINT IF EXISTS tenant_auth_provider_references_plugin_install_id_fkey,
  DROP CONSTRAINT IF EXISTS tenant_auth_provider_references_auth_provider_resource_id_fkey,
  ADD CONSTRAINT tenant_auth_provider_references_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ADD CONSTRAINT tenant_auth_provider_references_plugin_install_id_fkey
    FOREIGN KEY (plugin_install_id) REFERENCES public.plugin_installs(id) ON DELETE SET NULL,
  ADD CONSTRAINT tenant_auth_provider_references_auth_provider_resource_id_fkey
    FOREIGN KEY (auth_provider_resource_id) REFERENCES public.auth_provider_resources(id) ON DELETE RESTRICT;

DROP INDEX IF EXISTS public.uq_tenant_auth_provider_references_install_resource;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_auth_provider_references_tenant_resource
  ON public.tenant_auth_provider_references (tenant_id, auth_provider_resource_id);

CREATE TABLE IF NOT EXISTS public.tenant_auth_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  local_password_enabled boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'draft',
  revision integer NOT NULL DEFAULT 1,
  catalog_revision text,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_auth_policies_status_allowed
    CHECK (status IN ('draft', 'active', 'disabled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_auth_policies_tenant
  ON public.tenant_auth_policies (tenant_id);

-- Preserve the pre-native-auth behavior for existing tenants explicitly:
-- local password is enabled and validated global Google/Microsoft routes are
-- permitted by an active policy. Tenant-specific Entra references can then
-- replace general Microsoft without leaving older tenants policy-less.
INSERT INTO public.tenant_auth_policies (
  tenant_id,
  local_password_enabled,
  status,
  revision,
  created_at,
  updated_at
)
SELECT id, true, 'active', 1, now(), now()
FROM public.tenants
ON CONFLICT (tenant_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.ensure_default_tenant_auth_policy()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.tenant_auth_policies (
    tenant_id,
    local_password_enabled,
    status,
    revision,
    created_at,
    updated_at
  ) VALUES (NEW.id, true, 'active', 1, now(), now())
  ON CONFLICT (tenant_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenants_default_auth_policy ON public.tenants;
CREATE TRIGGER trg_tenants_default_auth_policy
AFTER INSERT ON public.tenants
FOR EACH ROW
EXECUTE FUNCTION public.ensure_default_tenant_auth_policy();

CREATE TABLE IF NOT EXISTS public.tenant_auth_hosts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  hostname text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_auth_hosts_status_allowed
    CHECK (status IN ('pending', 'verified', 'disabled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_auth_hosts_hostname
  ON public.tenant_auth_hosts (hostname);
CREATE INDEX IF NOT EXISTS idx_tenant_auth_hosts_tenant_status
  ON public.tenant_auth_hosts (tenant_id, status);

CREATE TABLE IF NOT EXISTS public.auth_route_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_key text NOT NULL,
  client_family text NOT NULL,
  cognito_user_pool_id text NOT NULL,
  cognito_app_client_id text NOT NULL,
  provider_names jsonb NOT NULL DEFAULT '[]'::jsonb,
  explicit_auth_flows jsonb NOT NULL DEFAULT '[]'::jsonb,
  redirect_uris jsonb NOT NULL DEFAULT '[]'::jsonb,
  logout_uris jsonb NOT NULL DEFAULT '[]'::jsonb,
  lifecycle_state text NOT NULL DEFAULT 'native',
  validation_status text NOT NULL DEFAULT 'unconfigured',
  desired_revision integer NOT NULL DEFAULT 1,
  resource_arn text,
  diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_route_clients_lifecycle_allowed
    CHECK (lifecycle_state IN ('coexistence', 'native', 'denied')),
  CONSTRAINT auth_route_clients_validation_allowed
    CHECK (validation_status IN ('unconfigured', 'validating', 'valid', 'partially_valid', 'invalid', 'rotating_secret', 'disabled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_route_clients_route_family
  ON public.auth_route_clients (route_key, client_family);
CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_route_clients_app_client
  ON public.auth_route_clients (cognito_app_client_id);
CREATE INDEX IF NOT EXISTS idx_auth_route_clients_lifecycle_status
  ON public.auth_route_clients (lifecycle_state, validation_status);

CREATE TABLE IF NOT EXISTS public.user_auth_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  auth_provider_resource_id uuid REFERENCES public.auth_provider_resources(id) ON DELETE RESTRICT,
  cognito_issuer text NOT NULL,
  cognito_sub text NOT NULL,
  provider_issuer text NOT NULL,
  provider_subject text NOT NULL,
  status text NOT NULL DEFAULT 'pending_proof',
  proof_kind text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  activated_at timestamptz,
  quarantined_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_auth_identities_status_allowed
    CHECK (status IN ('pending_proof', 'active', 'quarantined', 'revoked')),
  CONSTRAINT user_auth_identities_active_has_resource
    CHECK (status = 'quarantined' OR auth_provider_resource_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_auth_identities_cognito_sub
  ON public.user_auth_identities (cognito_issuer, cognito_sub);
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_auth_identities_provider_subject
  ON public.user_auth_identities (auth_provider_resource_id, provider_issuer, provider_subject);
CREATE INDEX IF NOT EXISTS idx_user_auth_identities_user_status
  ON public.user_auth_identities (user_id, status);
CREATE INDEX IF NOT EXISTS idx_user_auth_identities_tenant_status
  ON public.user_auth_identities (tenant_id, status);

CREATE TABLE IF NOT EXISTS public.auth_identity_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  intended_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  recipient_grant_kind text NOT NULL,
  recipient_grant_id uuid NOT NULL,
  auth_provider_resource_id uuid NOT NULL REFERENCES public.auth_provider_resources(id) ON DELETE RESTRICT,
  auth_route_client_id uuid NOT NULL REFERENCES public.auth_route_clients(id) ON DELETE RESTRICT,
  redirect_uri text NOT NULL,
  nonce_digest text NOT NULL,
  recipient_challenge_digest text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  proof jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_identity_enrollments_status_allowed
    CHECK (status IN ('pending', 'consumed', 'expired', 'revoked')),
  CONSTRAINT auth_identity_enrollments_grant_kind_allowed
    CHECK (recipient_grant_kind IN ('membership', 'pending_owner'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_identity_enrollments_nonce
  ON public.auth_identity_enrollments (nonce_digest);
CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_identity_enrollments_challenge
  ON public.auth_identity_enrollments (recipient_challenge_digest);
CREATE INDEX IF NOT EXISTS idx_auth_identity_enrollments_pending
  ON public.auth_identity_enrollments (tenant_id, status, expires_at);

CREATE TABLE IF NOT EXISTS public.auth_reconciliation_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage text NOT NULL,
  revision integer NOT NULL,
  idempotency_key text NOT NULL,
  manifest_fingerprint text NOT NULL,
  desired_connections jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_reconciliation_sets_status_allowed
    CHECK (status IN ('pending', 'applied', 'rejected'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_reconciliation_sets_stage_revision
  ON public.auth_reconciliation_sets (stage, revision);
CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_reconciliation_sets_idempotency
  ON public.auth_reconciliation_sets (idempotency_key);

CREATE TABLE IF NOT EXISTS public.auth_cutover_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage text NOT NULL,
  tenant_id uuid,
  inventory_fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'inventory',
  terminal_dispositions jsonb NOT NULL DEFAULT '{}'::jsonb,
  client_shutdown_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  drain_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_cutover_runs_status_allowed
    CHECK (status IN ('inventory', 'ready', 'cutting_over', 'soaking', 'rollback_required', 'complete', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_cutover_runs_stage_inventory
  ON public.auth_cutover_runs (stage, inventory_fingerprint);
CREATE INDEX IF NOT EXISTS idx_auth_cutover_runs_status
  ON public.auth_cutover_runs (stage, status);

CREATE TABLE IF NOT EXISTS public.auth_identity_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_auth_identity_id uuid NOT NULL REFERENCES public.user_auth_identities(id) ON DELETE RESTRICT,
  proof_digest text NOT NULL,
  proof_kind text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_identity_proofs_digest
  ON public.auth_identity_proofs (proof_digest);
CREATE INDEX IF NOT EXISTS idx_auth_identity_proofs_identity
  ON public.auth_identity_proofs (user_auth_identity_id);
