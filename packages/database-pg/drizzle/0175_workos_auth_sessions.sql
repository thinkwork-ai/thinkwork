-- 0175_workos_auth_sessions.sql
-- creates-column: public.workos_auth_bridges.workos_session_expires_at
-- creates: public.workos_auth_sessions
-- creates: public.idx_workos_auth_sessions_cognito_active
-- creates: public.idx_workos_auth_sessions_user_active
-- creates: public.idx_workos_auth_sessions_workos_session

ALTER TABLE workos_auth_bridges
  ADD COLUMN IF NOT EXISTS workos_session_expires_at timestamptz;

CREATE TABLE IF NOT EXISTS workos_auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_auth_provider_reference_id uuid NOT NULL REFERENCES tenant_auth_provider_references(id) ON DELETE CASCADE,
  auth_provider_resource_id uuid NOT NULL REFERENCES auth_provider_resources(id) ON DELETE CASCADE,
  cognito_principal_id text NOT NULL,
  cognito_username text NOT NULL,
  workos_user_id text NOT NULL,
  workos_session_id text NOT NULL,
  workos_email text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  expires_at timestamptz NOT NULL,
  logged_out_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workos_auth_sessions_status_allowed
    CHECK (status IN ('active', 'logged_out', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_workos_auth_sessions_cognito_active
  ON workos_auth_sessions (cognito_principal_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_workos_auth_sessions_user_active
  ON workos_auth_sessions (tenant_id, user_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_workos_auth_sessions_workos_session
  ON workos_auth_sessions (workos_session_id);
