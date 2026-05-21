-- Per-tenant catalog table backing the apps/computer Customize page's
-- Available / Discover sections for Workflows. Skills and MCP servers reuse
-- the existing `tenant_skills` and `tenant_mcp_servers` tables.
--
-- Plan:
--   docs/plans/2026-05-09-006-feat-computer-customization-page-plan.md
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0078_tenant_customize_catalog.sql
--
-- creates: public.tenant_workflow_catalog
-- creates: public.uq_tenant_workflow_catalog_slug
-- creates: public.idx_tenant_workflow_catalog_tenant_status

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS public.tenant_workflow_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug text NOT NULL,
  display_name text NOT NULL,
  description text,
  category text,
  icon text,
  default_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  default_schedule text,
  status text NOT NULL DEFAULT 'active',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_workflow_catalog_status_enum
    CHECK (status IN ('active','draft','archived'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_workflow_catalog_slug
  ON public.tenant_workflow_catalog (tenant_id, slug);

CREATE INDEX IF NOT EXISTS idx_tenant_workflow_catalog_tenant_status
  ON public.tenant_workflow_catalog (tenant_id, status);

COMMIT;
