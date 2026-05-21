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

-- No backfill: unlike `connectors.type`, `routines.name` is free-form
-- user-authored text with no structural alignment to any catalog
-- display_name. Existing routines stay with catalog_slug=NULL and
-- remain invisible to the Customize bindings query (which filters
-- `catalog_slug IS NOT NULL`); they're still functional via their
-- existing schedule/triggers, just not surfaced on the Workflows tab.
-- New Customize-driven enables get catalog_slug populated by the
-- enableWorkflow resolver.

-- Partial unique index: at most one routines row per
-- (agent, catalog slug). Excludes legacy / user-authored rows where
-- agent_id IS NULL or catalog_slug IS NULL.
CREATE UNIQUE INDEX IF NOT EXISTS uq_routines_catalog_slug_per_agent
  ON public.routines (agent_id, catalog_slug)
  WHERE agent_id IS NOT NULL AND catalog_slug IS NOT NULL;

COMMIT;
