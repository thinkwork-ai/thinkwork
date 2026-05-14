-- Rollback for 0078_tenant_customize_catalog.sql.
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0078_tenant_customize_catalog_rollback.sql

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DROP TABLE IF EXISTS public.tenant_workflow_catalog;

COMMIT;
