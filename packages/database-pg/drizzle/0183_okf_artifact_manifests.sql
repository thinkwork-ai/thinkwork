-- Purpose: widen brain.artifact_manifests so OKF bundle versions and current
--   manifest pointers can be recorded as generated projection evidence.
-- Plan: docs/plans/2026-06-22-002-feat-okf-wiki-navigator-plan.md U1
-- Apply manually (no CI migration runner):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0183_okf_artifact_manifests.sql
-- Pre-flight:
--   SELECT to_regclass('brain.artifact_manifests');
-- creates-constraint: brain.artifact_manifests.brain_artifact_manifests_kind_allowed
-- creates-constraint: brain.artifact_manifests.brain_artifact_manifests_source_kind_allowed

\set ON_ERROR_STOP on

SET lock_timeout = '5s';
SET statement_timeout = '15min';

DO $$
BEGIN
  IF to_regclass('brain.artifact_manifests') IS NULL THEN
    RAISE EXCEPTION 'brain.artifact_manifests not found; apply Company Brain artifact manifest migrations first';
  END IF;
END $$;

SELECT pg_advisory_lock(hashtext('migration:0183_okf_artifact_manifests'));

ALTER TABLE brain.artifact_manifests
  DROP CONSTRAINT IF EXISTS brain_artifact_manifests_kind_allowed;

ALTER TABLE brain.artifact_manifests
  ADD CONSTRAINT brain_artifact_manifests_kind_allowed
  CHECK (
    manifest_kind IN (
      'source_artifact',
      'ingestion_manifest',
      'migration_snapshot',
      'vault_projection',
      'export',
      'okf_bundle',
      'okf_current_manifest'
    )
  );

ALTER TABLE brain.artifact_manifests
  DROP CONSTRAINT IF EXISTS brain_artifact_manifests_source_kind_allowed;

ALTER TABLE brain.artifact_manifests
  ADD CONSTRAINT brain_artifact_manifests_source_kind_allowed
  CHECK (
    source_kind IS NULL
    OR source_kind IN ('thread', 'wiki', 'brain', 'observations', 'okf')
  );

SELECT pg_advisory_unlock(hashtext('migration:0183_okf_artifact_manifests'));
