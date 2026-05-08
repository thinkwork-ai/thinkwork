-- 0074_compliance_event_hash_index.sql
--
-- Phase 3 U10 of the System Workflows revert + Compliance reframe.
-- Adds a single-column index on `compliance.audit_events(event_hash)`
-- to support the new `complianceEventByHash` GraphQL query introduced
-- in U10. Without this index, the chain-position panel's prev_hash
-- click-through devolves to a heap scan; with it, lookups are
-- index-served at O(log n).
--
-- Why hand-rolled (not Drizzle-generated):
--   The compliance migrations are intentionally hand-rolled so the
--   plan-time SQL exactly matches what Aurora executes. The
--   compliance schema in this repo has been hand-rolled since 0069;
--   keeping additions in the same form avoids mixed-mode confusion.
--
-- Why not in 0069's original schema:
--   The forward-walking chain semantics (compliance.audit_events
--   chained via prev_hash → previous row's event_hash) was originally
--   designed to be walked sequentially with the (tenant_id,
--   occurred_at DESC) index. The "look up an event by its hash"
--   access pattern was added in U10 to power the admin Compliance
--   detail page's prev_hash navigation. Different access pattern →
--   different index.
--
-- Operator pre-merge step:
--   This migration is not picked up by the drainer's drift-gate
--   reconciler automatically — it must be applied to dev via:
--     psql "$DATABASE_URL" \
--       -f packages/database-pg/drizzle/0074_compliance_event_hash_index.sql
--   BEFORE the merge-to-main pipeline runs the post-deploy drift
--   check. The PR body should surface this requirement; the U8a / U8b
--   PRs followed the same pattern.

-- creates: compliance.idx_audit_events_event_hash

BEGIN;

-- Single-column btree on event_hash. Primary access pattern:
-- "given a prev_hash, find the row whose event_hash matches it."
-- Tenant-scoped lookups still use the existing (tenant_id, occurred_at
-- DESC) index for ordered enumeration; this index supports unordered
-- lookup-by-hash only.
--
-- IF NOT EXISTS so the migration is idempotent — re-running on dev
-- after a partial apply doesn't error.
CREATE INDEX IF NOT EXISTS idx_audit_events_event_hash
  ON compliance.audit_events (event_hash);

COMMIT;
