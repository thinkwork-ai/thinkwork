-- Purpose: add generic premium plugin entitlement and one-time install-key
--   storage for Company Brain and future premium plugins. Entitlements are
--   persistent tenant/plugin grants independent of install state; install keys
--   store digests only and can be redeemed once into an entitlement.
-- Plan: docs/plans/2026-06-13-002-feat-company-brain-premium-plugin-plan.md U2
-- Apply manually (no CI migration runner):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0165_plugin_premium_entitlements.sql
-- Pre-flight:
--   SELECT count(*) FROM public.tenants;
--   SELECT count(*) FROM public.users;
--   SELECT count(*) FROM public.plugin_installs;
-- creates: public.plugin_entitlements
-- creates: public.plugin_install_keys
-- creates: public.uq_plugin_entitlements_active_tenant_plugin
-- creates: public.idx_plugin_entitlements_tenant_plugin
-- creates: public.idx_plugin_entitlements_product_status
-- creates: public.uq_plugin_install_keys_digest
-- creates: public.idx_plugin_install_keys_lookup
-- creates: public.idx_plugin_install_keys_plugin_status
-- creates: public.idx_plugin_install_keys_tenant_status
-- creates-constraint: public.plugin_entitlements.plugin_entitlements_pkey
-- creates-constraint: public.plugin_entitlements.plugin_entitlements_tenant_id_tenants_id_fk
-- creates-constraint: public.plugin_entitlements.plugin_entitlements_granted_by_user_id_users_id_fk
-- creates-constraint: public.plugin_entitlements.plugin_entitlements_status_allowed
-- creates-constraint: public.plugin_entitlements.plugin_entitlements_source_allowed
-- creates-constraint: public.plugin_install_keys.plugin_install_keys_pkey
-- creates-constraint: public.plugin_install_keys.plugin_install_keys_tenant_id_tenants_id_fk
-- creates-constraint: public.plugin_install_keys.plugin_install_keys_issued_by_user_id_users_id_fk
-- creates-constraint: public.plugin_install_keys.plugin_install_keys_redeemed_by_user_id_users_id_fk
-- creates-constraint: public.plugin_install_keys.plugin_install_keys_redeemed_tenant_id_tenants_id_fk
-- creates-constraint: public.plugin_install_keys.plugin_install_keys_redeemed_entitlement_id_fk
-- creates-constraint: public.plugin_install_keys.plugin_install_keys_status_allowed
-- creates-constraint: public.plugin_install_keys.plugin_install_keys_redeemed_fields

\set ON_ERROR_STOP on

SET lock_timeout = '5s';
SET statement_timeout = '15min';

SELECT pg_advisory_lock(hashtext('migration:0165_plugin_premium_entitlements'));

-- ---------------------------------------------------------------------------
-- plugin_entitlements — persistent tenant premium grants
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.plugin_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  plugin_key text NOT NULL,
  entitlement_product_key text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  source text NOT NULL,
  granted_by_user_id uuid,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plugin_entitlements_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT plugin_entitlements_granted_by_user_id_users_id_fk
    FOREIGN KEY (granted_by_user_id)
    REFERENCES public.users(id)
    ON DELETE SET NULL,
  CONSTRAINT plugin_entitlements_status_allowed
    CHECK (status IN ('active', 'revoked')),
  CONSTRAINT plugin_entitlements_source_allowed
    CHECK (source IN ('install_key', 'backdoor_key', 'operator_grant', 'migration'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_plugin_entitlements_active_tenant_plugin
  ON public.plugin_entitlements (tenant_id, plugin_key)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_plugin_entitlements_tenant_plugin
  ON public.plugin_entitlements (tenant_id, plugin_key);

CREATE INDEX IF NOT EXISTS idx_plugin_entitlements_product_status
  ON public.plugin_entitlements (entitlement_product_key, status);

-- ---------------------------------------------------------------------------
-- plugin_install_keys — digest-only one-time premium install keys
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.plugin_install_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plugin_key text NOT NULL,
  entitlement_product_key text NOT NULL,
  key_digest text NOT NULL,
  digest_algorithm text NOT NULL DEFAULT 'sha256',
  key_secret_version text,
  tenant_id uuid,
  status text NOT NULL DEFAULT 'issued',
  issued_by_user_id uuid,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  redeemed_by_user_id uuid,
  redeemed_tenant_id uuid,
  redeemed_entitlement_id uuid,
  redeemed_at timestamptz,
  audit_correlation_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plugin_install_keys_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE SET NULL,
  CONSTRAINT plugin_install_keys_issued_by_user_id_users_id_fk
    FOREIGN KEY (issued_by_user_id)
    REFERENCES public.users(id)
    ON DELETE SET NULL,
  CONSTRAINT plugin_install_keys_redeemed_by_user_id_users_id_fk
    FOREIGN KEY (redeemed_by_user_id)
    REFERENCES public.users(id)
    ON DELETE SET NULL,
  CONSTRAINT plugin_install_keys_redeemed_tenant_id_tenants_id_fk
    FOREIGN KEY (redeemed_tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE SET NULL,
  CONSTRAINT plugin_install_keys_redeemed_entitlement_id_fk
    FOREIGN KEY (redeemed_entitlement_id)
    REFERENCES public.plugin_entitlements(id)
    ON DELETE SET NULL,
  CONSTRAINT plugin_install_keys_status_allowed
    CHECK (status IN ('issued', 'redeemed', 'revoked', 'expired')),
  CONSTRAINT plugin_install_keys_redeemed_fields
    CHECK (
      status <> 'redeemed'
      OR (
        redeemed_at IS NOT NULL
        AND redeemed_tenant_id IS NOT NULL
        AND redeemed_entitlement_id IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_plugin_install_keys_digest
  ON public.plugin_install_keys (key_digest);

CREATE INDEX IF NOT EXISTS idx_plugin_install_keys_lookup
  ON public.plugin_install_keys (plugin_key, key_digest);

CREATE INDEX IF NOT EXISTS idx_plugin_install_keys_plugin_status
  ON public.plugin_install_keys (plugin_key, status);

CREATE INDEX IF NOT EXISTS idx_plugin_install_keys_tenant_status
  ON public.plugin_install_keys (tenant_id, status);

SELECT pg_advisory_unlock(hashtext('migration:0165_plugin_premium_entitlements'));
