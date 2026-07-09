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
-- The constraint is RENAMED to *_v2 (0160 precedent), not re-added under
-- the same name: the drift reporter probes constraints by name presence
-- only, and a same-named constraint with the OLD definition exists on
-- every stage — a same-name rewrite would read APPLIED everywhere even
-- when this file never ran, and the first rds_iam insert would then hit
-- the old CHECK. The rename makes the probe meaningful.
--
-- Hand-rolled per convention (drizzle snapshot frozen; precedent
-- 0160/0207). Guarded so re-runs are no-ops once the v2 definition is in
-- place.
--
-- Apply manually (verification pass before merge):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
--     -f packages/database-pg/drizzle/0228_tenant_credentials_rds_iam_kind.sql
--
-- drops-constraint: public.tenant_credentials.tenant_credentials_kind_enum
-- creates-constraint: public.tenant_credentials.tenant_credentials_kind_enum_v2

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
  ) THEN
    ALTER TABLE public.tenant_credentials
      DROP CONSTRAINT tenant_credentials_kind_enum;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenant_credentials_kind_enum_v2'
      AND conrelid = 'public.tenant_credentials'::regclass
  ) THEN
    ALTER TABLE public.tenant_credentials
      ADD CONSTRAINT tenant_credentials_kind_enum_v2
      CHECK (kind IN ('api_key','bearer_token','basic_auth','soap_partner','webhook_signing_secret','json','github_repo','rds_iam'));
  END IF;
END $$;

COMMIT;
