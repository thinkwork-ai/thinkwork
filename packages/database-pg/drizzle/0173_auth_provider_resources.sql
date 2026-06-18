-- creates: public.auth_provider_resources
-- creates: public.tenant_auth_provider_references
-- creates: public.uq_auth_provider_resources_cognito_idp
-- creates: public.idx_auth_provider_resources_provider_status
-- creates: public.uq_tenant_auth_provider_references_install_resource
-- creates: public.idx_tenant_auth_provider_references_tenant_status
-- creates: public.idx_tenant_auth_provider_references_resource

ALTER TABLE public.plugin_components
  DROP CONSTRAINT IF EXISTS plugin_components_type_allowed;

ALTER TABLE public.plugin_components
  ADD CONSTRAINT plugin_components_type_allowed
  CHECK (component_type IN ('mcp-server', 'skills', 'infrastructure', 'ui-surface', 'auth-provider'));

CREATE TABLE IF NOT EXISTS public.auth_provider_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  provider_key text NOT NULL,
  display_name text NOT NULL,
  cognito_user_pool_id text NOT NULL,
  cognito_app_client_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
  cognito_identity_provider_name text NOT NULL,
  issuer_url text NOT NULL,
  client_id text NOT NULL,
  client_secret_ref text NOT NULL,
  authorize_scopes text DEFAULT 'openid profile email' NOT NULL,
  public_option_mode text DEFAULT 'single_sso' NOT NULL,
  provider_options jsonb DEFAULT '[]'::jsonb NOT NULL,
  validation_status text DEFAULT 'unconfigured' NOT NULL,
  public_options_published boolean DEFAULT false NOT NULL,
  last_validated_at timestamp with time zone,
  last_error_code text,
  diagnostics jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT auth_provider_resources_validation_status_allowed
    CHECK (validation_status IN ('unconfigured', 'validating', 'valid', 'partially_valid', 'invalid', 'rotating_secret', 'disabled')),
  CONSTRAINT auth_provider_resources_public_option_mode_allowed
    CHECK (public_option_mode IN ('single_sso', 'provider_specific')),
  CONSTRAINT auth_provider_resources_no_public_without_valid
    CHECK (public_options_published = false OR validation_status IN ('valid', 'partially_valid'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_provider_resources_cognito_idp
  ON public.auth_provider_resources (
    provider_key,
    cognito_user_pool_id,
    cognito_identity_provider_name
  );

CREATE INDEX IF NOT EXISTS idx_auth_provider_resources_provider_status
  ON public.auth_provider_resources (provider_key, validation_status);

CREATE TABLE IF NOT EXISTS public.tenant_auth_provider_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  plugin_install_id uuid NOT NULL REFERENCES public.plugin_installs(id) ON DELETE CASCADE,
  auth_provider_resource_id uuid NOT NULL REFERENCES public.auth_provider_resources(id) ON DELETE CASCADE,
  status text DEFAULT 'disabled' NOT NULL,
  hostnames jsonb DEFAULT '[]'::jsonb NOT NULL,
  public_option_label text DEFAULT 'Continue with SSO' NOT NULL,
  enabled_at timestamp with time zone,
  disabled_at timestamp with time zone,
  last_error_code text,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT tenant_auth_provider_references_status_allowed
    CHECK (status IN ('disabled', 'enabled', 'invalid', 'decommissioning'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_auth_provider_references_install_resource
  ON public.tenant_auth_provider_references (
    tenant_id,
    plugin_install_id,
    auth_provider_resource_id
  );

CREATE INDEX IF NOT EXISTS idx_tenant_auth_provider_references_tenant_status
  ON public.tenant_auth_provider_references (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_tenant_auth_provider_references_resource
  ON public.tenant_auth_provider_references (auth_provider_resource_id);
