-- Purpose: add tenant-scoped Bedrock model catalog state.
-- Plan: docs/plans/2026-06-09-001-feat-tenant-model-catalog-plan.md U1
-- Apply manually (no CI migration runner):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0155_tenant_model_catalog.sql
-- Pre-flight:
--   SELECT count(*) FROM public.model_catalog;
--   SELECT count(*) FROM public.tenants;
-- creates: public.tenant_model_catalog
-- creates: public.idx_tenant_model_catalog_tenant_enabled
-- creates: public.idx_tenant_model_catalog_model
-- creates-constraint: public.tenant_model_catalog.tenant_model_catalog_pkey
-- creates-constraint: public.tenant_model_catalog.tenant_model_catalog_tenant_id_tenants_id_fk
-- creates-constraint: public.tenant_model_catalog.tenant_model_catalog_model_id_model_catalog_model_id_fk
-- creates-constraint: public.tenant_model_catalog.tenant_model_catalog_imported_by_user_id_users_id_fk
-- creates-constraint: public.tenant_model_catalog.tenant_model_catalog_pricing_status_allowed
-- creates-constraint: public.tenant_model_catalog.tenant_model_catalog_enabled_requires_resolved_pricing

\set ON_ERROR_STOP on

SET lock_timeout = '5s';
SET statement_timeout = '15min';

SELECT pg_advisory_lock(hashtext('migration:0155_tenant_model_catalog'));

CREATE TABLE IF NOT EXISTS public.tenant_model_catalog (
  tenant_id uuid NOT NULL,
  model_id text NOT NULL,
  display_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  pricing_status text NOT NULL DEFAULT 'missing',
  pricing_source text,
  pricing_diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_priced_at timestamptz,
  import_source text NOT NULL DEFAULT 'backfill',
  import_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_by_user_id uuid,
  imported_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_model_catalog_pkey
    PRIMARY KEY (tenant_id, model_id),
  CONSTRAINT tenant_model_catalog_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT tenant_model_catalog_model_id_model_catalog_model_id_fk
    FOREIGN KEY (model_id)
    REFERENCES public.model_catalog(model_id)
    ON DELETE CASCADE,
  CONSTRAINT tenant_model_catalog_imported_by_user_id_users_id_fk
    FOREIGN KEY (imported_by_user_id)
    REFERENCES public.users(id)
    ON DELETE SET NULL,
  CONSTRAINT tenant_model_catalog_pricing_status_allowed
    CHECK (pricing_status IN ('resolved', 'missing', 'ambiguous', 'error')),
  CONSTRAINT tenant_model_catalog_enabled_requires_resolved_pricing
    CHECK (enabled IS FALSE OR pricing_status = 'resolved')
);

CREATE INDEX IF NOT EXISTS idx_tenant_model_catalog_tenant_enabled
  ON public.tenant_model_catalog (tenant_id, enabled);

CREATE INDEX IF NOT EXISTS idx_tenant_model_catalog_model
  ON public.tenant_model_catalog (model_id);

WITH referenced_models AS (
  SELECT tenant_id, default_model AS model_id
  FROM public.tenant_settings
  WHERE tenant_id IS NOT NULL
    AND default_model IS NOT NULL

  UNION

  SELECT tenant_id, model AS model_id
  FROM public.agents
  WHERE model IS NOT NULL
    AND status <> 'archived'

  UNION

  SELECT tenant_id, model AS model_id
  FROM public.agent_templates
  WHERE tenant_id IS NOT NULL
    AND model IS NOT NULL

  UNION

  SELECT tenant_id, model_id
  FROM public.agent_profiles
  WHERE model_id IS NOT NULL

  UNION

  SELECT tenant_id, model_id
  FROM public.user_model_approvals
),
eligible_models AS (
  SELECT DISTINCT
    rm.tenant_id,
    mc.model_id,
    mc.display_name,
    mc.input_cost_per_million,
    mc.output_cost_per_million
  FROM referenced_models rm
  JOIN public.model_catalog mc
    ON mc.model_id = rm.model_id
   AND mc.is_available IS TRUE
  WHERE rm.tenant_id IS NOT NULL
)
INSERT INTO public.tenant_model_catalog (
  tenant_id,
  model_id,
  display_name,
  enabled,
  pricing_status,
  pricing_source,
  pricing_diagnostics,
  last_priced_at,
  import_source,
  import_payload
)
SELECT
  tenant_id,
  model_id,
  display_name,
  (input_cost_per_million IS NOT NULL AND output_cost_per_million IS NOT NULL) AS enabled,
  CASE
    WHEN input_cost_per_million IS NOT NULL AND output_cost_per_million IS NOT NULL
      THEN 'resolved'
    ELSE 'missing'
  END AS pricing_status,
  CASE
    WHEN input_cost_per_million IS NOT NULL AND output_cost_per_million IS NOT NULL
      THEN 'legacy-model-catalog'
    ELSE NULL
  END AS pricing_source,
  CASE
    WHEN input_cost_per_million IS NOT NULL AND output_cost_per_million IS NOT NULL
      THEN jsonb_build_object('backfilledFrom', 'model_catalog')
    ELSE jsonb_build_object('reason', 'model_catalog_missing_token_costs')
  END AS pricing_diagnostics,
  CASE
    WHEN input_cost_per_million IS NOT NULL AND output_cost_per_million IS NOT NULL
      THEN now()
    ELSE NULL
  END AS last_priced_at,
  'backfill' AS import_source,
  jsonb_build_object('referencedBy', 'existing tenant defaults, agents, profiles, templates, or approvals') AS import_payload
FROM eligible_models
ON CONFLICT (tenant_id, model_id) DO NOTHING;

SELECT pg_advisory_unlock(hashtext('migration:0155_tenant_model_catalog'));
