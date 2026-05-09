-- Rollback for 0080_connectors_catalog_slug.sql.
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0080_connectors_catalog_slug_rollback.sql

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DROP INDEX IF EXISTS public.uq_connectors_catalog_slug_per_computer;

ALTER TABLE public.connectors
  DROP COLUMN IF EXISTS catalog_slug;

COMMIT;
