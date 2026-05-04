-- Rollback for 0064_tenant_credentials.sql.

\set ON_ERROR_STOP on

BEGIN;

DROP TABLE IF EXISTS public.tenant_credentials;

COMMIT;
