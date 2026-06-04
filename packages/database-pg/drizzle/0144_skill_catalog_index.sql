-- Purpose: re-add a per-tenant index of the S3 skill catalog so the Skills
--   settings list reads one query instead of scanning S3 + reading every file.
--   Derived read cache; S3 stays source of truth. Per-tenant (the dropped
--   global skill_catalog from 0131 was not tenant-scoped).
-- Plan: docs/plans/2026-06-04-002-feat-skills-catalog-db-index-plan.md U1
-- Apply manually (no CI migration runner):
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0144_skill_catalog_index.sql
-- Pre-flight:
--   SELECT to_regclass('public.skill_catalog');
--   SELECT to_regclass('public.uq_skill_catalog_tenant_slug');
-- creates: public.skill_catalog
-- creates: public.uq_skill_catalog_tenant_slug
-- creates: public.idx_skill_catalog_tenant
-- creates-constraint: public.skill_catalog.skill_catalog_tenant_id_fkey

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('migration:0144_skill_catalog_index'));

CREATE TABLE IF NOT EXISTS skill_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug text NOT NULL,
  display_name text,
  description text,
  category text,
  icon text,
  tags text[],
  content_sha text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_skill_catalog_tenant_slug
  ON skill_catalog (tenant_id, slug);

CREATE INDEX IF NOT EXISTS idx_skill_catalog_tenant
  ON skill_catalog (tenant_id);

COMMIT;
