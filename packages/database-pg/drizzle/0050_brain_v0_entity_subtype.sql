-- Brain v0 entity subtype foundation.
--
-- Plan:
--   docs/plans/2026-04-29-004-feat-company-brain-v0-plan.md
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0050_brain_v0_entity_subtype.sql
--
-- creates-column: public.wiki_pages.entity_subtype

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.wiki_pages
  ADD COLUMN IF NOT EXISTS entity_subtype text;

CREATE INDEX IF NOT EXISTS idx_wiki_pages_entity_subtype
  ON public.wiki_pages (entity_subtype)
  WHERE entity_subtype IS NOT NULL;

COMMENT ON COLUMN public.wiki_pages.entity_subtype
  IS 'brain-v0: docs/plans/2026-04-29-004-feat-company-brain-v0-plan.md';

COMMIT;
