-- Rollback for 0077_computers_primary_agent_id.sql.
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0077_computers_primary_agent_id_rollback.sql

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DROP INDEX IF EXISTS public.idx_computers_primary_agent;

ALTER TABLE public.computers
  DROP COLUMN IF EXISTS primary_agent_id;

COMMIT;
