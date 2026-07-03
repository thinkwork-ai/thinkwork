-- Purpose: admit 'github_repo' in the tenant_credentials kind CHECK
-- (deterministic routines v1, plan 2026-07-03-004 U2 follow-up). U2
-- (#3273) added the GraphQL enum value, REQUIRED_FIELDS entry, and
-- save-time connection validation but missed the DB CHECK — the first
-- real save of a routine-repo credential violated
-- tenant_credentials_kind_enum. Caught during the U9 acceptance sweep.
--
-- Hand-rolled per convention (drizzle snapshot frozen; precedent
-- 0205/0206). Drop + re-add under the same name, guarded so re-runs are
-- no-ops once the new definition is in place.
--
-- Apply manually (verification pass before merge):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
--     -f packages/database-pg/drizzle/0207_tenant_credentials_github_repo_kind.sql
--
-- creates-constraint: public.tenant_credentials.tenant_credentials_kind_enum

\set ON_ERROR_STOP on

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('tenant_credentials_github_repo_0207'));

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenant_credentials_kind_enum'
      AND conrelid = 'public.tenant_credentials'::regclass
      AND pg_get_constraintdef(oid) NOT LIKE '%github_repo%'
  ) THEN
    ALTER TABLE public.tenant_credentials
      DROP CONSTRAINT tenant_credentials_kind_enum;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenant_credentials_kind_enum'
      AND conrelid = 'public.tenant_credentials'::regclass
  ) THEN
    ALTER TABLE public.tenant_credentials
      ADD CONSTRAINT tenant_credentials_kind_enum
      CHECK (kind IN ('api_key','bearer_token','basic_auth','soap_partner','webhook_signing_secret','json','github_repo'));
  END IF;
END $$;

COMMIT;
