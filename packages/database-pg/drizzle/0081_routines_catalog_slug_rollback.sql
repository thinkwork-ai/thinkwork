-- Rollback for 0081_routines_catalog_slug.sql.
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0081_routines_catalog_slug_rollback.sql
--
-- drops: public.uq_routines_catalog_slug_per_agent
-- drops-column: public.routines.catalog_slug

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DROP INDEX IF EXISTS public.uq_routines_catalog_slug_per_agent;

ALTER TABLE public.routines
  DROP COLUMN IF EXISTS catalog_slug;

COMMIT;
