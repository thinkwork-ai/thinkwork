-- Rollback for 0065_connector_tables.sql.
--
-- This drops the inert connector data foundation in reverse-FK order. If later
-- connector PRs have started writing live data, pause dispatch and archive or
-- export connector rows before running this rollback.
--
-- drops: public.connector_executions
-- drops: public.connectors

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DROP TABLE IF EXISTS public.connector_executions;
DROP TABLE IF EXISTS public.connectors;

COMMIT;
