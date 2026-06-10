-- Purpose: relax the wiki owner-scope covenant for tenant-scoped pages —
--          `owner_id` becomes nullable on wiki.pages AND wiki.compile_jobs
--          (graph-mode compile jobs are tenant-keyed), and a partial unique
--          index enforces (tenant_id, type, slug) uniqueness for null-owner
--          pages (the existing four-column unique treats NULLs as distinct
--          and would silently allow duplicate tenant pages).
--          Purely additive: nothing drops, no data changes. User-scoped
--          pages keep their owner_id; the U11 cutover archive pass is a
--          separate, later migration.
-- Plan: docs/plans/2026-06-09-004-feat-cognee-centric-memory-pipeline-plan.md (U9)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0158_wiki_tenant_scope.sql
-- creates: wiki.uq_pages_tenant_type_slug_tenant_scope
-- Note: the two ALTER COLUMN ... DROP NOT NULL statements (wiki.pages.owner_id,
-- wiki.compile_jobs.owner_id) have no drift-reporter marker convention —
-- nullability changes aren't object creations. They are idempotent.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';

-- Tenant-scoped pages carry owner_id NULL (graph→wiki materializer).
ALTER TABLE wiki.pages
  ALTER COLUMN owner_id DROP NOT NULL;

-- Graph-mode compile jobs are tenant-keyed — same covenant change.
ALTER TABLE wiki.compile_jobs
  ALTER COLUMN owner_id DROP NOT NULL;

-- Integrity-load-bearing: uq_pages_tenant_owner_type_slug treats NULL
-- owner_id as distinct, so duplicate (tenant, type, slug) tenant pages
-- would otherwise insert silently. All existing indexes stay untouched.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pages_tenant_type_slug_tenant_scope
  ON wiki.pages (tenant_id, type, slug)
  WHERE owner_id IS NULL;

COMMIT;
