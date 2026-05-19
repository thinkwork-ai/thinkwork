-- Wiki/Brain owner repair after schema extraction.
--
-- The 0089/0090 schema-extraction migrations moved already-populated tables
-- from public.* into wiki.* and brain.*. In long-lived dev/prod databases,
-- those tables can retain an older table owner even when the deployed
-- GraphQL/wiki Lambdas connect as the current migration role. Direct writes
-- to wiki.* then fail at compile time with permission errors.
--
-- Apply manually:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0102_wiki_brain_owner_repair.sql
--
-- creates: public.view_wiki_brain_owner_repaired

\set ON_ERROR_STOP on

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('wiki_brain_owner_repair'));

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF current_database() != 'thinkwork' THEN
    RAISE EXCEPTION 'wrong database: %, expected thinkwork', current_database();
  END IF;
END $$;

DO $$
DECLARE
  required_table text;
BEGIN
  FOREACH required_table IN ARRAY ARRAY[
    'wiki.pages',
    'wiki.page_sections',
    'wiki.page_links',
    'wiki.page_aliases',
    'wiki.unresolved_mentions',
    'wiki.section_sources',
    'wiki.compile_jobs',
    'wiki.compile_cursors',
    'wiki.places',
    'brain.pages',
    'brain.page_sections',
    'brain.page_links',
    'brain.page_aliases',
    'brain.section_sources',
    'brain.external_refs'
  ]
  LOOP
    IF to_regclass(required_table) IS NULL THEN
      RAISE EXCEPTION 'pre-flight: % does not exist', required_table;
    END IF;
  END LOOP;
END $$;

ALTER SCHEMA wiki OWNER TO CURRENT_USER;
ALTER SCHEMA brain OWNER TO CURRENT_USER;

ALTER TABLE wiki.pages OWNER TO CURRENT_USER;
ALTER TABLE wiki.page_sections OWNER TO CURRENT_USER;
ALTER TABLE wiki.page_links OWNER TO CURRENT_USER;
ALTER TABLE wiki.page_aliases OWNER TO CURRENT_USER;
ALTER TABLE wiki.unresolved_mentions OWNER TO CURRENT_USER;
ALTER TABLE wiki.section_sources OWNER TO CURRENT_USER;
ALTER TABLE wiki.compile_jobs OWNER TO CURRENT_USER;
ALTER TABLE wiki.compile_cursors OWNER TO CURRENT_USER;
ALTER TABLE wiki.places OWNER TO CURRENT_USER;

ALTER TABLE brain.pages OWNER TO CURRENT_USER;
ALTER TABLE brain.page_sections OWNER TO CURRENT_USER;
ALTER TABLE brain.page_links OWNER TO CURRENT_USER;
ALTER TABLE brain.page_aliases OWNER TO CURRENT_USER;
ALTER TABLE brain.section_sources OWNER TO CURRENT_USER;
ALTER TABLE brain.external_refs OWNER TO CURRENT_USER;

CREATE OR REPLACE VIEW public.view_wiki_brain_owner_repaired AS
SELECT
  current_database() AS database_name,
  'wiki_brain_owner_repair'::text AS repair,
  true AS applied;

COMMENT ON VIEW public.view_wiki_brain_owner_repaired IS
  'Drift marker for 0102_wiki_brain_owner_repair.sql.';

COMMIT;
