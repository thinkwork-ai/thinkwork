-- Rename persisted Data Integrations plugin keys to Company ETL.
-- Plan: THNK-71 U3, Rename Data Integrations plugin to Company ETL.
--
-- Apply through deploy.yml before the GraphQL Lambda serving the renamed
-- catalog is deployed:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f packages/database-pg/drizzle/0188_company_etl_plugin_rename.sql
--
-- Drift detection:
--   bash scripts/db-migrate-manual.sh packages/database-pg/drizzle/0188_company_etl_plugin_rename.sql
--
-- Pre-flight:
--   SELECT to_regclass('public.plugin_installs') AS plugin_installs;
--   SELECT to_regclass('public.plugin_entitlements') AS plugin_entitlements;
--   SELECT to_regclass('public.plugin_install_keys') AS plugin_install_keys;
--
-- creates: public.view_company_etl_plugin_rename_0188

DO $$
BEGIN
  IF to_regclass('public.plugin_installs') IS NULL THEN
    RAISE EXCEPTION 'plugin_installs not found; apply application plugin migrations first';
  END IF;
  IF to_regclass('public.plugin_entitlements') IS NULL THEN
    RAISE EXCEPTION 'plugin_entitlements not found; apply premium plugin migrations first';
  END IF;
  IF to_regclass('public.plugin_install_keys') IS NULL THEN
    RAISE EXCEPTION 'plugin_install_keys not found; apply premium plugin migrations first';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.plugin_installs
    WHERE plugin_key IN ('data-integrations', 'company-etl')
    GROUP BY tenant_id
    HAVING COUNT(DISTINCT plugin_key) = 2
  ) THEN
    RAISE EXCEPTION 'company-etl rename conflict: tenant has both data-integrations and company-etl plugin_installs rows';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.plugin_entitlements
    WHERE plugin_key IN ('data-integrations', 'company-etl')
      AND status = 'active'
    GROUP BY tenant_id
    HAVING COUNT(DISTINCT plugin_key) = 2
  ) THEN
    RAISE EXCEPTION 'company-etl rename conflict: tenant has both active data-integrations and company-etl plugin_entitlements rows';
  END IF;
END $$;

UPDATE public.plugin_installs
SET
  plugin_key = 'company-etl',
  pinned_payload_sha256 = '49681471c865d81257872da252538f84345f42b43299c27764fc2714bb2e8abf',
  updated_at = now()
WHERE plugin_key = 'data-integrations';

UPDATE public.plugin_entitlements
SET
  plugin_key = 'company-etl',
  entitlement_product_key = CASE
    WHEN entitlement_product_key = 'data-integrations' THEN 'company-etl'
    ELSE entitlement_product_key
  END,
  updated_at = now()
WHERE plugin_key = 'data-integrations';

UPDATE public.plugin_install_keys
SET
  plugin_key = 'company-etl',
  entitlement_product_key = CASE
    WHEN entitlement_product_key = 'data-integrations' THEN 'company-etl'
    ELSE entitlement_product_key
  END,
  updated_at = now()
WHERE plugin_key = 'data-integrations';

CREATE OR REPLACE VIEW public.view_company_etl_plugin_rename_0188 AS
SELECT
  NOT EXISTS (
    SELECT 1 FROM public.plugin_installs WHERE plugin_key = 'data-integrations'
  ) AS plugin_installs_migrated,
  NOT EXISTS (
    SELECT 1 FROM public.plugin_entitlements WHERE plugin_key = 'data-integrations'
  ) AS plugin_entitlements_migrated,
  NOT EXISTS (
    SELECT 1 FROM public.plugin_install_keys WHERE plugin_key = 'data-integrations'
  ) AS plugin_install_keys_migrated,
  NOT EXISTS (
    SELECT 1
    FROM public.plugin_installs
    WHERE plugin_key = 'company-etl'
      AND pinned_version = '0.1.0'
      AND pinned_payload_sha256 <> '49681471c865d81257872da252538f84345f42b43299c27764fc2714bb2e8abf'
  ) AS company_etl_pinned_payload_digest_current;
