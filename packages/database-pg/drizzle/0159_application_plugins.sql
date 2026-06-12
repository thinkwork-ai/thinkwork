-- Purpose: add the application-plugin engine tables — canonical install,
--   component, and user-activation state for the plugin system. Installs pin
--   a catalog version + payload sha256; components carry handler linkage
--   (handler_ref) for read-time reconciliation against deployment jobs;
--   activations hold one app-level OAuth grant per (user, install) with one
--   token record per RFC 8707 resource indicator. Also adds the
--   tenant_mcp_servers.plugin_install_id ownership column for plugin-managed
--   MCP rows.
-- Plan: docs/plans/2026-06-12-001-feat-application-plugins-plan.md U4
-- Apply manually (no CI migration runner):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0159_application_plugins.sql
-- Pre-flight:
--   SELECT count(*) FROM public.tenants;
--   SELECT count(*) FROM public.users;
--   SELECT count(*) FROM public.tenant_mcp_servers;
-- creates: public.plugin_installs
-- creates: public.plugin_components
-- creates: public.user_plugin_activations
-- creates: public.user_plugin_activation_tokens
-- creates: public.uq_plugin_installs_tenant_plugin
-- creates: public.idx_plugin_installs_tenant_state
-- creates: public.uq_plugin_components_install_key
-- creates: public.idx_plugin_components_install
-- creates: public.uq_user_plugin_activations
-- creates: public.idx_user_plugin_activations_install
-- creates: public.uq_user_plugin_activation_tokens_resource
-- creates-column: public.tenant_mcp_servers.plugin_install_id
-- creates-constraint: public.plugin_installs.plugin_installs_pkey
-- creates-constraint: public.plugin_installs.plugin_installs_tenant_id_tenants_id_fk
-- creates-constraint: public.plugin_installs.plugin_installs_state_allowed
-- creates-constraint: public.plugin_components.plugin_components_pkey
-- creates-constraint: public.plugin_components.plugin_components_plugin_install_id_plugin_installs_id_fk
-- creates-constraint: public.plugin_components.plugin_components_state_allowed
-- creates-constraint: public.plugin_components.plugin_components_type_allowed
-- creates-constraint: public.user_plugin_activations.user_plugin_activations_pkey
-- creates-constraint: public.user_plugin_activations.user_plugin_activations_user_id_users_id_fk
-- creates-constraint: public.user_plugin_activations.user_plugin_activations_plugin_install_id_plugin_installs_id_fk
-- creates-constraint: public.user_plugin_activations.user_plugin_activations_status_allowed
-- creates-constraint: public.user_plugin_activation_tokens.user_plugin_activation_tokens_pkey
-- creates-constraint: public.user_plugin_activation_tokens.user_plugin_activation_tokens_activation_id_fk
-- creates-constraint: public.user_plugin_activation_tokens.user_plugin_activation_tokens_status_allowed
-- creates-constraint: public.tenant_mcp_servers.tenant_mcp_servers_plugin_install_id_plugin_installs_id_fk

\set ON_ERROR_STOP on

SET lock_timeout = '5s';
SET statement_timeout = '15min';

SELECT pg_advisory_lock(hashtext('migration:0159_application_plugins'));

-- ---------------------------------------------------------------------------
-- plugin_installs — one row per (tenant, plugin); pins the catalog version
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.plugin_installs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  plugin_key text NOT NULL,
  pinned_version text NOT NULL,
  pinned_payload_sha256 text NOT NULL,
  state text NOT NULL DEFAULT 'installing',
  idempotency_key text NOT NULL,
  last_transition_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plugin_installs_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT plugin_installs_state_allowed
    CHECK (state IN ('installing', 'awaiting_approval', 'installed', 'partially_installed', 'failed', 'uninstalling'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_plugin_installs_tenant_plugin
  ON public.plugin_installs (tenant_id, plugin_key);

CREATE INDEX IF NOT EXISTS idx_plugin_installs_tenant_state
  ON public.plugin_installs (tenant_id, state);

-- ---------------------------------------------------------------------------
-- plugin_components — per-component provisioning state under an install
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.plugin_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plugin_install_id uuid NOT NULL,
  component_key text NOT NULL,
  component_type text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  handler_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plugin_components_plugin_install_id_plugin_installs_id_fk
    FOREIGN KEY (plugin_install_id)
    REFERENCES public.plugin_installs(id)
    ON DELETE CASCADE,
  CONSTRAINT plugin_components_state_allowed
    CHECK (state IN ('pending', 'provisioned', 'failed')),
  CONSTRAINT plugin_components_type_allowed
    CHECK (component_type IN ('mcp-server', 'skills', 'infrastructure', 'ui-surface'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_plugin_components_install_key
  ON public.plugin_components (plugin_install_id, component_key);

CREATE INDEX IF NOT EXISTS idx_plugin_components_install
  ON public.plugin_components (plugin_install_id);

-- ---------------------------------------------------------------------------
-- user_plugin_activations — one app-level OAuth grant per (user, install)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_plugin_activations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  plugin_install_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active',
  granted_scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_plugin_activations_user_id_users_id_fk
    FOREIGN KEY (user_id)
    REFERENCES public.users(id)
    ON DELETE CASCADE,
  CONSTRAINT user_plugin_activations_plugin_install_id_plugin_installs_id_fk
    FOREIGN KEY (plugin_install_id)
    REFERENCES public.plugin_installs(id)
    ON DELETE CASCADE,
  CONSTRAINT user_plugin_activations_status_allowed
    CHECK (status IN ('active', 'needs_reauth', 'revoked'))
);

-- Doubles as the dispatch-time activation lookup (user_id, plugin_install_id).
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_plugin_activations
  ON public.user_plugin_activations (user_id, plugin_install_id);

-- activatedUserCount: count of 'active' activations per install.
CREATE INDEX IF NOT EXISTS idx_user_plugin_activations_install
  ON public.user_plugin_activations (plugin_install_id);

-- ---------------------------------------------------------------------------
-- user_plugin_activation_tokens — one token record per resource indicator
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_plugin_activation_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activation_id uuid NOT NULL,
  resource_indicator text NOT NULL,
  secret_ref text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Explicit short name: the drizzle-derived name exceeds Postgres's 63-char
  -- identifier limit (matches the foreignKey() name in src/schema/plugins.ts).
  CONSTRAINT user_plugin_activation_tokens_activation_id_fk
    FOREIGN KEY (activation_id)
    REFERENCES public.user_plugin_activations(id)
    ON DELETE CASCADE,
  CONSTRAINT user_plugin_activation_tokens_status_allowed
    CHECK (status IN ('active', 'expired', 'revoked'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_plugin_activation_tokens_resource
  ON public.user_plugin_activation_tokens (activation_id, resource_indicator);

-- ---------------------------------------------------------------------------
-- tenant_mcp_servers.plugin_install_id — plugin ownership marker
-- ---------------------------------------------------------------------------

ALTER TABLE public.tenant_mcp_servers
  ADD COLUMN IF NOT EXISTS plugin_install_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_mcp_servers_plugin_install_id_plugin_installs_id_fk'
      AND conrelid = 'public.tenant_mcp_servers'::regclass
  ) THEN
    ALTER TABLE public.tenant_mcp_servers
      ADD CONSTRAINT tenant_mcp_servers_plugin_install_id_plugin_installs_id_fk
      FOREIGN KEY (plugin_install_id)
      REFERENCES public.plugin_installs(id)
      ON DELETE SET NULL;
  END IF;
END $$;

SELECT pg_advisory_unlock(hashtext('migration:0159_application_plugins'));
