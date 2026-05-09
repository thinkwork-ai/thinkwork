-- Add a stable pointer from `connectors` rows back to the
-- `tenant_connector_catalog.slug` they represent, so the apps/computer
-- Customize page (plan 008 U4) can match Connected items unambiguously
-- instead of falling back to the brittle `connectors.type == slug`
-- heuristic.
--
-- Plan:
--   docs/plans/2026-05-09-008-feat-customize-connectors-live-plan.md (U4-1)
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0080_connectors_catalog_slug.sql
--
-- creates-column: public.connectors.catalog_slug
-- creates: public.uq_connectors_catalog_slug_per_computer

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.connectors
  ADD COLUMN IF NOT EXISTS catalog_slug text;

-- Backfill where the existing `type` already aligns with a seeded catalog
-- slug for the same tenant. Connectors whose `type` does not match a
-- catalog row stay with catalog_slug=NULL; the bindings query filters
-- those out, so they're invisible to the Customize page until the user
-- (or a follow-on backfill) re-binds them through the new mutations.
UPDATE public.connectors c
   SET catalog_slug = tcc.slug
  FROM public.tenant_connector_catalog tcc
 WHERE c.tenant_id = tcc.tenant_id
   AND c.type = tcc.slug
   AND c.catalog_slug IS NULL;

-- Partial unique index: at most one connectors row per
-- (tenant, Computer dispatch target, catalog slug). Excludes legacy rows
-- where catalog_slug IS NULL or dispatch_target_type<>'computer'. Created
-- after the backfill so any pre-existing duplicates surface as a clear
-- index-build failure instead of silently masking real data.
CREATE UNIQUE INDEX IF NOT EXISTS uq_connectors_catalog_slug_per_computer
  ON public.connectors (tenant_id, dispatch_target_id, catalog_slug)
  WHERE dispatch_target_type = 'computer' AND catalog_slug IS NOT NULL;

COMMIT;
