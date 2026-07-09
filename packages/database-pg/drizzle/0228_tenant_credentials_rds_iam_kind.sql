-- Purpose: admit 'rds_iam' in the tenant_credentials kind CHECK
-- (THINK-229 U1 / R2 — analyst connection hardening,
-- docs/plans/2026-07-08-002-feat-analyst-connection-hardening-plan.md).
--
-- rds_iam is the metadata-only credential kind for Thinkwork-owned Aurora:
-- the row records cluster endpoint, port, database, DB user, and cluster
-- resource ID in metadata_json; secret_ref is an empty sentinel because no
-- long-lived secret exists — 15-minute RDS IAM auth tokens are minted
-- per-connect in the trusted analyst-query-broker Lambda.
--
-- Hand-rolled per convention (drizzle snapshot frozen; precedent 0207).
-- Drop + re-add under the same name, guarded so re-runs are no-ops once
-- the new definition is in place.
--
-- Apply manually (verification pass before merge):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
--     -f packages/database-pg/drizzle/0228_tenant_credentials_rds_iam_kind.sql
--
-- creates-constraint: public.tenant_credentials.tenant_credentials_kind_enum

\set ON_ERROR_STOP on

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('tenant_credentials_rds_iam_0228'));

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenant_credentials_kind_enum'
      AND conrelid = 'public.tenant_credentials'::regclass
      AND pg_get_constraintdef(oid) NOT LIKE '%rds_iam%'
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
      CHECK (kind IN ('api_key','bearer_token','basic_auth','soap_partner','webhook_signing_secret','json','github_repo','rds_iam'));
  END IF;
END $$;

COMMIT;
