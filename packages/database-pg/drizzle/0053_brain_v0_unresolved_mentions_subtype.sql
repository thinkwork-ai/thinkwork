-- Brain v0 subtype suggestion for unresolved mentions.
--
-- Plan:
--   docs/plans/2026-04-29-004-feat-company-brain-v0-plan.md
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0053_brain_v0_unresolved_mentions_subtype.sql
--
-- creates-column: public.wiki_unresolved_mentions.entity_subtype
-- creates-constraint: public.wiki_unresolved_mentions.wiki_unresolved_mentions_entity_subtype_allowed

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
BEGIN
  IF to_regclass('public.tenant_entity_pages') IS NULL THEN
    RAISE EXCEPTION '0053 requires public.tenant_entity_pages from 0051';
  END IF;
END $$;

ALTER TABLE public.wiki_unresolved_mentions
  ADD COLUMN IF NOT EXISTS entity_subtype text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'wiki_unresolved_mentions_entity_subtype_allowed'
  ) THEN
    ALTER TABLE public.wiki_unresolved_mentions
      ADD CONSTRAINT wiki_unresolved_mentions_entity_subtype_allowed
      CHECK (entity_subtype IS NULL OR entity_subtype IN ('customer','opportunity','order','person','concept','reflection'));
  END IF;
END $$;

COMMENT ON COLUMN public.wiki_unresolved_mentions.entity_subtype
  IS 'brain-v0: docs/plans/2026-04-29-004-feat-company-brain-v0-plan.md';

COMMIT;
