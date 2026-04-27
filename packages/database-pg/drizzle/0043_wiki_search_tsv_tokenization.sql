-- Normalize wiki_pages.search_tsv tokenization for punctuation-separated terms.
--
-- Plan:
--   docs/plans/2026-04-27-001-fix-mobile-wiki-search-tsv-plan.md
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0043_wiki_search_tsv_tokenization.sql
--
-- This is hand-rolled because generated column expressions cannot be changed
-- in place on all supported Postgres/Aurora versions. search_tsv is derived
-- data, so rebuilding the column and its GIN index is safe.
--
-- creates-column: public.wiki_pages.search_tsv
-- creates: public.idx_wiki_pages_search_tsv

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DROP INDEX IF EXISTS public.idx_wiki_pages_search_tsv;

ALTER TABLE public.wiki_pages
  DROP COLUMN IF EXISTS search_tsv;

ALTER TABLE public.wiki_pages
  ADD COLUMN search_tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'english'::regconfig,
      regexp_replace(
        coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(body_md, ''),
        '[^[:alnum:]]+',
        ' ',
        'g'
      )
    )
  ) STORED;

CREATE INDEX idx_wiki_pages_search_tsv
  ON public.wiki_pages
  USING gin (search_tsv);

COMMIT;
