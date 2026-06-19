-- THNK-43 U2: short-lived WorkOS primary-auth bridge records.
-- creates: public.workos_auth_bridges
-- creates: public.uq_workos_auth_bridges_code_digest
-- creates: public.idx_workos_auth_bridges_tenant_status
-- creates: public.idx_workos_auth_bridges_reference

CREATE TABLE IF NOT EXISTS workos_auth_bridges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tenant_auth_provider_reference_id uuid NOT NULL REFERENCES tenant_auth_provider_references(id) ON DELETE CASCADE,
  auth_provider_resource_id uuid NOT NULL REFERENCES auth_provider_resources(id) ON DELETE CASCADE,
  bridge_code_digest text NOT NULL,
  workos_user_id text NOT NULL,
  workos_session_id text NOT NULL,
  workos_email text NOT NULL,
  workos_email_verified boolean NOT NULL DEFAULT false,
  workos_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  state_nonce text NOT NULL,
  redirect_uri text NOT NULL,
  return_to text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workos_auth_bridges_status_allowed
    CHECK (status IN ('pending', 'consumed', 'expired'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_workos_auth_bridges_code_digest
  ON workos_auth_bridges (bridge_code_digest);

CREATE INDEX IF NOT EXISTS idx_workos_auth_bridges_tenant_status
  ON workos_auth_bridges (tenant_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_workos_auth_bridges_reference
  ON workos_auth_bridges (tenant_auth_provider_reference_id);
