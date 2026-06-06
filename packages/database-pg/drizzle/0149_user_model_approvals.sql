-- Purpose: allow tenant admins to approve the model catalog per user.
-- Plan: docs/plans/2026-06-06-004-feat-model-stacking-tool-routing-plan.md U1
-- Apply manually (no CI migration runner):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0149_user_model_approvals.sql
-- Pre-flight:
--   SELECT count(*) FROM public.users WHERE tenant_id IS NOT NULL;
--   SELECT model_id, is_available FROM public.model_catalog ORDER BY display_name;
-- creates: public.user_model_approvals
-- creates: public.uq_user_model_approvals_tenant_user_model
-- creates: public.idx_user_model_approvals_tenant_user
-- creates: public.idx_user_model_approvals_model
-- creates-constraint: public.user_model_approvals.user_model_approvals_tenant_id_tenants_id_fk
-- creates-constraint: public.user_model_approvals.user_model_approvals_user_id_users_id_fk
-- creates-constraint: public.user_model_approvals.user_model_approvals_model_id_model_catalog_model_id_fk

\set ON_ERROR_STOP on

SET lock_timeout = '5s';
SET statement_timeout = '15min';

SELECT pg_advisory_lock(hashtext('migration:0149_user_model_approvals'));

CREATE TABLE IF NOT EXISTS public.user_model_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  model_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_model_approvals_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT user_model_approvals_user_id_users_id_fk
    FOREIGN KEY (user_id)
    REFERENCES public.users(id)
    ON DELETE CASCADE,
  CONSTRAINT user_model_approvals_model_id_model_catalog_model_id_fk
    FOREIGN KEY (model_id)
    REFERENCES public.model_catalog(model_id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_model_approvals_tenant_user_model
  ON public.user_model_approvals (tenant_id, user_id, model_id);

CREATE INDEX IF NOT EXISTS idx_user_model_approvals_tenant_user
  ON public.user_model_approvals (tenant_id, user_id);

CREATE INDEX IF NOT EXISTS idx_user_model_approvals_model
  ON public.user_model_approvals (model_id);

WITH default_models AS (
  SELECT tenant_id, default_model AS model_id
  FROM public.tenant_settings
  WHERE default_model IS NOT NULL

  UNION

  SELECT tenant_id, model AS model_id
  FROM public.agents
  WHERE model IS NOT NULL
    AND status <> 'archived'

  UNION

  SELECT tenant_id, model AS model_id
  FROM public.agent_templates
  WHERE model IS NOT NULL
),
available_defaults AS (
  SELECT DISTINCT
    u.tenant_id,
    u.id AS user_id,
    d.model_id
  FROM public.users u
  JOIN default_models d
    ON d.tenant_id = u.tenant_id
  JOIN public.model_catalog mc
    ON mc.model_id = d.model_id
   AND mc.is_available IS TRUE
  WHERE u.tenant_id IS NOT NULL
)
INSERT INTO public.user_model_approvals (tenant_id, user_id, model_id)
SELECT tenant_id, user_id, model_id
FROM available_defaults
ON CONFLICT (tenant_id, user_id, model_id) DO NOTHING;

SELECT pg_advisory_unlock(hashtext('migration:0149_user_model_approvals'));
