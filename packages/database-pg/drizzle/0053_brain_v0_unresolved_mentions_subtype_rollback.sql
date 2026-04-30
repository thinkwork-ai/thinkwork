-- Rollback only. Apply manually if Brain v0 unresolved mention subtype is abandoned.
--
-- drops-column: public.wiki_unresolved_mentions.entity_subtype
-- drops-constraint: public.wiki_unresolved_mentions_entity_subtype_allowed

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE public.wiki_unresolved_mentions
  DROP CONSTRAINT IF EXISTS wiki_unresolved_mentions_entity_subtype_allowed;
ALTER TABLE public.wiki_unresolved_mentions
  DROP COLUMN IF EXISTS entity_subtype;

COMMIT;
