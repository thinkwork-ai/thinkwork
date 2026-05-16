-- 0092_finish_oss_connector_retirement.sql
--
-- Finishes the OSS connector framework retirement that 0087 started.
-- 0087 was authored but never applied to dev — the code-side retirement
-- (Drizzle schemas removed, lib/connectors/* deleted, handler retired,
-- resolvers gone) shipped via separate PRs, but the DROP TABLE side
-- never ran because 0087 had downstream-rendered itself unable to apply
-- as-written after 0090 moved tenant_entity_external_refs into the
-- brain schema (0087's ALTER TABLE public.tenant_entity_external_refs
-- statements would now fail because that table no longer exists in
-- public.*).
--
-- This migration does ONLY the table-drop portion of 0087. The
-- tenant_entity_external_refs constraint work (DELETE tracker rows +
-- DROP + re-ADD constraint) is already done by 0090's bundled
-- cleanup — see 0090's header for that history.
--
-- Tables dropped (4):
--   public.connector_executions  (33 rows in dev as of 2026-05-16, all stale)
--   public.connectors            (1 row in dev, stale)
--   public.tenant_connector_catalog  (20 rows, stale)
--   public.computer_delegations  (10 rows, stale)
--
-- Indexes drop automatically with their parent tables (CASCADE). The
-- 14 index-drop markers in 0087's header resolve to DROPPED naturally
-- once the parent tables are gone.
--
-- The only inbound FK to any of these tables is
-- connector_executions.connector_id -> connectors.id, which is in the
-- drop set itself. No external tables reference these — DROP CASCADE is
-- safe.
--
-- Plan reference:    docs/plans/2026-05-14-001-refactor-retire-oss-symphony-connectors-plan.md
-- Prior migration:   0087_retire_oss_connectors.sql (authored but never applied to dev — superseded by this file's table-drop scope)
-- Wiki+brain arc:    PRs #1251, #1259, #1264
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0092_finish_oss_connector_retirement.sql
-- Then verify:
--   pnpm db:migrate-manual packages/database-pg/drizzle/0092_finish_oss_connector_retirement.sql
--   psql -c "\dt public.connectors"            -- 0 rows expected
--   psql -c "\dt public.connector_executions"  -- 0 rows expected
--   psql -c "\dt public.tenant_connector_catalog"  -- 0 rows expected
--   psql -c "\dt public.computer_delegations"  -- 0 rows expected
--
-- No rollback documented — the OSS connector framework is retired in
-- application code (origin/main has no schema files, no lib code, no
-- handlers, no resolvers referencing these tables). Recreating the
-- tables without recreating the framework would leave dead schema
-- behind. If a true rollback is needed, revert at the application
-- layer first.
--
-- Markers (consumed by scripts/db-migrate-manual.sh):
--
-- drops: public.connector_executions
-- drops: public.connectors
-- drops: public.tenant_connector_catalog
-- drops: public.computer_delegations

\set ON_ERROR_STOP on

BEGIN;

-- Timeouts before any potentially blocking operation. DROP TABLE takes
-- ACCESS EXCLUSIVE on the table; bounded waits ensure the migration
-- fails fast if anything is actively reading.
SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '60s';

SELECT pg_advisory_xact_lock(hashtext('finish_oss_connector_retirement'));

-- Refuse to apply against an unexpected DB.
DO $$
BEGIN
  IF current_database() != 'thinkwork' THEN
    RAISE EXCEPTION 'wrong database: %, expected thinkwork', current_database();
  END IF;
END $$;

-- Pre-flight: confirm we're on a DB that still has the tables.
-- (Idempotent — if a re-run finds the tables already gone, the
-- DROP TABLE IF EXISTS statements will no-op cleanly.)
DO $$
BEGIN
  IF to_regclass('public.tenant_entity_external_refs') IS NOT NULL THEN
    RAISE EXCEPTION 'pre-flight: public.tenant_entity_external_refs still exists — 0090 (brain schema extraction) must apply first';
  END IF;
END $$;

-- Leaf-first DROP order: connector_executions references connectors via
-- FK, so drop it first. CASCADE handles internal index drops + the FK.
DROP TABLE IF EXISTS public.connector_executions CASCADE;
DROP TABLE IF EXISTS public.connectors CASCADE;
DROP TABLE IF EXISTS public.tenant_connector_catalog CASCADE;
DROP TABLE IF EXISTS public.computer_delegations CASCADE;

COMMIT;
