-- Add a stable pointer from `routines` rows back to the
-- `tenant_workflow_catalog.slug` they represent, so the apps/computer
-- Customize Workflows tab (plan 010 U6) can match Connected items
-- unambiguously and the enableWorkflow / disableWorkflow mutations can
-- upsert idempotently.
--
-- Plan:
--   docs/plans/2026-05-09-010-feat-customize-workflows-live-plan.md (U6-1)
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0081_routines_catalog_slug.sql
--
-- creates-column: public.routines.catalog_slug
-- creates: public.uq_routines_catalog_slug_per_agent

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.routines
  ADD COLUMN IF NOT EXISTS catalog_slug text;

-- Best-effort backfill where an existing routine's `name` already
-- matches a catalog row's display_name for the same tenant. Most
-- user-authored routines won't align (routines are typically named
-- by humans, not the catalog), so this is mostly a no-op — those rows
-- stay with catalog_slug=NULL and remain invisible to the Customize
-- bindings query, which filters `catalog_slug IS NOT NULL`.
UPDATE public.routines r
   SET catalog_slug = twc.slug
  FROM public.tenant_workflow_catalog twc
 WHERE r.tenant_id = twc.tenant_id
   AND r.name = twc.display_name
   AND r.catalog_slug IS NULL;

-- Partial unique index: at most one routines row per
-- (agent, catalog slug). Excludes legacy / user-authored rows where
-- agent_id IS NULL or catalog_slug IS NULL. Created after the backfill
-- so any pre-existing duplicates surface as a clear index-build failure
-- instead of silently masking real data.
CREATE UNIQUE INDEX IF NOT EXISTS uq_routines_catalog_slug_per_agent
  ON public.routines (agent_id, catalog_slug)
  WHERE agent_id IS NOT NULL AND catalog_slug IS NOT NULL;

COMMIT;
