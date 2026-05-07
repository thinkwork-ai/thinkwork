-- 0070_compliance_aurora_roles.sql
--
-- Phase 3 U2 of the System Workflows revert + Compliance reframe.
-- Provisions the three Aurora roles that scope per-tier access to the
-- compliance.* schema introduced in U1 (drizzle/0069_compliance_schema.sql,
-- merged via PR #880):
--
--   - compliance_writer:   USAGE on schema + INSERT only on audit_outbox
--                          and export_jobs. Used by Yoga resolvers and
--                          Lambda handlers via the U3 emitAuditEvent
--                          helper.
--   - compliance_drainer:  USAGE + SELECT/UPDATE on audit_outbox + SELECT
--                          on actor_pseudonym + INSERT only on
--                          audit_events. Used exclusively by the U4
--                          single-writer outbox drainer Lambda
--                          (reserved-concurrency=1).
--   - compliance_reader:   USAGE + SELECT-only on all four compliance.*
--                          tables. Used by the graphql-http Lambda for
--                          the U10 admin Compliance section read paths.
--
-- Plan reference:
--   docs/plans/2026-05-07-001-feat-compliance-u2-aurora-roles-plan.md
--   docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md
--
-- Apply manually:
--   STAGE=dev bash scripts/bootstrap-compliance-roles.sh
--
-- The bootstrap helper script:
--   1. Resolves master DB credentials from Secrets Manager.
--   2. Resolves / generates the three role passwords.
--   3. Populates the three compliance secret containers via
--      `aws secretsmanager put-secret-value`.
--   4. Creates/alters the three Aurora roles inline via psql heredoc
--      (NOT in this file — see WHY below).
--   5. Applies this file (GRANTs only).
--
-- WHY role create/alter is in the bootstrap script, not this file:
-- psql client-side variable substitution does NOT expand inside
-- dollar-quoted plpgsql blocks. The previous shape (CREATE/ALTER ROLE
-- inside DO blocks with caller-supplied passwords) failed with a
-- syntax error on the first deploy.yml compliance-bootstrap run on
-- 2026-05-07. The bootstrap script now interpolates passwords in bash
-- with single-quote doubling and runs per-role psql heredocs. GRANTs
-- stay in this file because they need no variables.
--
-- GRANT statements are inherently idempotent in PostgreSQL — re-running
-- this file is safe.
--
-- Markers (consumed by scripts/db-migrate-manual.sh as the post-deploy drift gate):
--
-- creates-role: compliance_writer
-- creates-role: compliance_drainer
-- creates-role: compliance_reader

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Refuse to apply against an unexpected DB. Hand-rolled migrations are
-- applied by an operator and a stale DATABASE_URL pointing at a non-dev
-- target would create roles in the wrong cluster.
DO $$
BEGIN
  IF current_database() != 'thinkwork' THEN
    RAISE EXCEPTION 'wrong database: %, expected thinkwork', current_database();
  END IF;
END $$;

-- Refuse to apply if the U1 compliance schema is missing. PostgreSQL
-- CREATE ROLE is NOT transactional — it commits to pg_authid before the
-- subsequent GRANT statements run, so a 0070 apply against a database
-- without 0069 would leave three roles with passwords but zero grants.
-- The drift gate then probes pg_roles and reports APPLIED, masking the
-- partial state. This guard converts the silent partial failure into a
-- hard stop before any role creation.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM information_schema.schemata WHERE schema_name = 'compliance') THEN
    RAISE EXCEPTION 'compliance schema missing: apply drizzle/0069_compliance_schema.sql first (U1, PR #880)';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Role existence guard
--
-- The bootstrap script creates / alters the three roles via inline psql
-- BEFORE this file runs. Refuse to apply if any role is missing — a
-- direct `psql -f` invocation that bypasses the bootstrap would
-- otherwise leave the schema partially granted.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'compliance_writer') THEN
    RAISE EXCEPTION 'compliance_writer role missing: run scripts/bootstrap-compliance-roles.sh first';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'compliance_drainer') THEN
    RAISE EXCEPTION 'compliance_drainer role missing: run scripts/bootstrap-compliance-roles.sh first';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'compliance_reader') THEN
    RAISE EXCEPTION 'compliance_reader role missing: run scripts/bootstrap-compliance-roles.sh first';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Schema-level USAGE for all three roles
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA compliance TO compliance_writer, compliance_drainer, compliance_reader;

-- ---------------------------------------------------------------------------
-- compliance_writer — INSERT only on audit_outbox + export_jobs
--
-- The U3 emitAuditEvent helper inserts into audit_outbox in the caller's
-- transaction. The U11 createAuditExport mutation inserts into
-- export_jobs. Writer has no SELECT, no UPDATE, no DELETE, no access to
-- audit_events (only the drainer writes there) or actor_pseudonym (read
-- via the reader role for typeahead lookups in the admin UI).
-- ---------------------------------------------------------------------------

GRANT INSERT ON compliance.audit_outbox TO compliance_writer;
GRANT INSERT ON compliance.export_jobs TO compliance_writer;

-- ---------------------------------------------------------------------------
-- compliance_drainer — pulls outbox, computes hash chain, writes audit_events
--
-- SELECT + UPDATE on audit_outbox: poll FOR UPDATE SKIP LOCKED, mark
-- drained_at on success, write drainer_error on failure.
-- SELECT on actor_pseudonym: needed if the drainer canonicalizes the
-- payload with actor_id resolution (Decision #5 in the master plan
-- keeps actor_id opaque in audit rows; pseudonym lookup is read-only).
-- INSERT on audit_events: append-only chained log.
--
-- No DELETE/TRUNCATE on any table — drainer never removes outbox rows
-- (drained_at marker is the soft-tombstone) and never modifies historical
-- audit events. The U1 immutability triggers are belt-and-suspenders on
-- top of this grant boundary.
-- ---------------------------------------------------------------------------

GRANT SELECT, UPDATE ON compliance.audit_outbox TO compliance_drainer;
GRANT SELECT ON compliance.actor_pseudonym TO compliance_drainer;
GRANT INSERT ON compliance.audit_events TO compliance_drainer;

-- ---------------------------------------------------------------------------
-- compliance_reader — SELECT-only on all four tables
--
-- The U10 admin Compliance section reads via this role: events list,
-- detail drawer, exports filter resolution, verification status panel,
-- pseudonym typeahead resolution. No write surface; the U11 export
-- mutation flow uses compliance_writer for the export_jobs INSERT and
-- only reads via this role.
-- ---------------------------------------------------------------------------

GRANT SELECT ON compliance.audit_outbox TO compliance_reader;
GRANT SELECT ON compliance.audit_events TO compliance_reader;
GRANT SELECT ON compliance.actor_pseudonym TO compliance_reader;
GRANT SELECT ON compliance.export_jobs TO compliance_reader;

COMMIT;
