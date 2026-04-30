-- Rollback only. Apply manually if Brain v0 schema addition is abandoned.
--
-- drops-column: public.wiki_pages.entity_subtype

\set ON_ERROR_STOP on

BEGIN;

DROP INDEX IF EXISTS public.idx_wiki_pages_entity_subtype;
ALTER TABLE public.wiki_pages DROP COLUMN IF EXISTS entity_subtype;

COMMIT;
