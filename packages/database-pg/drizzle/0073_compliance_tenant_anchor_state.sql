-- 0073_compliance_tenant_anchor_state.sql
--
-- Phase 3 U8a of the System Workflows revert + Compliance reframe.
-- (Originally drafted as 0071 but renumbered to 0073 to avoid collision
-- with the unrelated 0071_connector_computer_dispatch_target.sql that
-- shipped on origin/main concurrently with this work.)
-- Adds the per-tenant high-water-mark table the anchor Lambda uses to
-- track which audit_events have been included in a Merkle anchor.
--
-- Schema:
--   compliance.tenant_anchor_state(
--     tenant_id                   uuid PRIMARY KEY,
--     last_anchored_recorded_at   timestamptz,
--     last_anchored_event_id      uuid,
--     last_cadence_id             uuid,
--     updated_at                  timestamptz NOT NULL DEFAULT now()
--   )
--
-- Anchor advance: at each cadence, the Lambda updates each tenant's row
-- with the maximum recorded_at across the events included in the cadence
-- (and the corresponding event_id for tie-breaking on equal timestamps).
-- The next cadence's chain-head SELECT uses
-- `recorded_at > last_anchored_recorded_at` (or > '-infinity' for
-- never-anchored tenants).
--
-- Role grants:
--   compliance_drainer gets SELECT/INSERT/UPDATE (not DELETE) on the new
--   table. Per master plan U8a Decision #5, the anchor Lambda reuses the
--   compliance_drainer role for tenant_anchor_state writes rather than
--   provisioning a 4th Aurora role. The anchor Lambda runs reserved-
--   concurrency=1 (matching the drainer pattern), so the role widening
--   is bounded to one concurrent writer.
--
-- Plan reference:
--   docs/plans/2026-05-07-010-feat-compliance-u8a-anchor-lambda-inert-plan.md
--   docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md
--
-- Apply manually (operator step before merging — drift gate currently
-- disabled per #905):
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0073_compliance_tenant_anchor_state.sql
--
-- Markers (consumed by scripts/db-migrate-manual.sh as the post-deploy drift gate):
--
-- creates: compliance.tenant_anchor_state
-- creates: compliance.idx_tenant_anchor_state_updated_at

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Database guard — ensures we never accidentally apply to a wrong-named
-- database. Mirrors 0069 + 0070 prologue.
DO $$
BEGIN
  IF current_database() NOT IN ('thinkwork', 'postgres') THEN
    RAISE EXCEPTION 'Wrong database: %, expected thinkwork or postgres', current_database();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- compliance.tenant_anchor_state
--
-- One row per tenant. The anchor Lambda updates last_anchored_recorded_at
-- with the maximum recorded_at across the events included in the latest
-- Merkle cadence's tenant slice (tie-broken by event_id for equal
-- timestamps). Seeded lazily on first anchor — never-anchored tenants
-- have no row, and the chain-head SELECT uses
-- COALESCE(last_anchored_recorded_at, '-infinity'::timestamptz) so they
-- still surface every event.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS compliance.tenant_anchor_state (
  tenant_id                   uuid PRIMARY KEY,
  last_anchored_recorded_at   timestamptz,
  last_anchored_event_id      uuid,
  last_cadence_id             uuid,
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

-- Index for the watchdog's eventual "oldest un-anchored tenant" query
-- (U8b consumes this; U8a creates it inert).
CREATE INDEX IF NOT EXISTS idx_tenant_anchor_state_updated_at
  ON compliance.tenant_anchor_state (updated_at);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

-- USAGE on schema is already granted to compliance_drainer in 0070; this
-- restatement is for clarity (idempotent in PostgreSQL).
GRANT USAGE ON SCHEMA compliance TO compliance_drainer;

-- The anchor Lambda needs SELECT (read latest seq), INSERT (seed first
-- row per tenant), UPDATE (advance high-water-mark). No DELETE — this
-- table is append-or-update-only.
GRANT SELECT, INSERT, UPDATE ON compliance.tenant_anchor_state TO compliance_drainer;

-- compliance_reader gets SELECT for the eventual U10 admin Compliance UI
-- (showing per-tenant anchor lag). Read-only by intent.
GRANT SELECT ON compliance.tenant_anchor_state TO compliance_reader;

COMMIT;
