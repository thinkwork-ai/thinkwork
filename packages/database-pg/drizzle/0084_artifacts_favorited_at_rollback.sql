-- Rollback for 0084_artifacts_favorited_at.sql.
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0084_artifacts_favorited_at_rollback.sql

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DROP INDEX IF EXISTS public.idx_artifacts_favorited_at;

ALTER TABLE public.artifacts
  DROP COLUMN IF EXISTS favorited_at;

COMMIT;
