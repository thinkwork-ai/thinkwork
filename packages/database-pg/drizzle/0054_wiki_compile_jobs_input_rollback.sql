-- Rollback for 0054_wiki_compile_jobs_input.sql.
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0054_wiki_compile_jobs_input_rollback.sql

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE wiki_compile_jobs
  DROP COLUMN IF EXISTS input;

COMMIT;
