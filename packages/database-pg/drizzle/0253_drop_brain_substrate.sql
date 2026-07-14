-- 0253_drop_brain_substrate.sql
--
-- THINK-290 U5 PR B. Drops the retired graph-substrate residue:
-- `brain.substrate_states`, `brain.substrate_migrations`,
-- `brain.substrate_events`, and the dead `substrate_id` / `migration_id`
-- columns on `brain.artifact_manifests` (verified all-NULL across every
-- row on dev; no readers or writers remain — the Drizzle defs, relations,
-- enum constants, and tests were removed in U5 PR A, #3761, which is
-- deployed everywhere this migration may run).
--
-- ARCHIVE FIRST (procedural, per-stage, recorded in the PR body before
-- that stage applies this file):
--   pg_dump --no-owner --no-privileges --table='brain.substrate_*' \
--     -f substrate-archive-<stage>-<date>.sql
--   aws s3 cp substrate-archive-<stage>-<date>.sql \
--     s3://thinkwork-<stage>-backups/think-290/
--
-- Idempotent: every statement is guarded, so re-apply (including the
-- unattended runner sweep) is a clean no-op. Column drops cascade their
-- FK constraints (artifact_manifests_substrate_id_fk / _migration_id_fk)
-- and column-local indexes (brain_artifact_manifests_substrate_kind_idx /
-- brain_artifact_manifests_migration_idx) automatically.
--
-- Plan reference: docs/plans/2026-07-14-001-refactor-kg-schema-extraction-and-brain-cleanup-plan.md (U5)
-- PR A (code removal, merged): #3761
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0253_drop_brain_substrate.sql
-- Then verify:
--   bash scripts/db-migrate-manual.sh packages/database-pg/drizzle/0253_drop_brain_substrate.sql
--
-- Inverse runbook (rollback): restore from the stage's archival dump
-- (schema + data), then re-add the two artifact_manifests columns and
-- FKs from the dump's DDL.
--
-- Markers (consumed by scripts/db-migrate-manual.sh):
--
-- drops: brain.substrate_events
-- drops: brain.substrate_migrations
-- drops: brain.substrate_states
-- drops-column: brain.artifact_manifests.substrate_id
-- drops-column: brain.artifact_manifests.migration_id
-- drops-constraint: brain.artifact_manifests.artifact_manifests_substrate_id_fk
-- drops-constraint: brain.artifact_manifests.artifact_manifests_migration_id_fk

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '300s';

SELECT pg_advisory_xact_lock(hashtext('drop_brain_substrate'));

DO $$
BEGIN
  IF current_database() != 'thinkwork' THEN
    RAISE EXCEPTION 'wrong database: %, expected thinkwork', current_database();
  END IF;
END $$;

-- Visibility: record what is being dropped in the apply log. Archival is
-- enforced procedurally (PR-body checklist per stage), not here — a header
-- note cannot constrain the unattended runner, so the two-PR split plus
-- idempotent guards carry the safety instead.
DO $$
DECLARE
  t text;
  n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['substrate_states', 'substrate_migrations', 'substrate_events'] LOOP
    IF to_regclass('brain.' || t) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM brain.%I', t) INTO n;
      RAISE NOTICE 'dropping brain.% (% rows)', t, n;
    ELSE
      RAISE NOTICE 'brain.% already absent — skipping', t;
    END IF;
  END LOOP;
END $$;

-- FK dependency order: artifact_manifests references states + migrations
-- (columns must go first, taking their FKs and indexes with them); events
-- references states + migrations; migrations references states.
ALTER TABLE brain.artifact_manifests DROP COLUMN IF EXISTS substrate_id;
ALTER TABLE brain.artifact_manifests DROP COLUMN IF EXISTS migration_id;

DROP TABLE IF EXISTS brain.substrate_events;
DROP TABLE IF EXISTS brain.substrate_migrations;
DROP TABLE IF EXISTS brain.substrate_states;

COMMIT;
