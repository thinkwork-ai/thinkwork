-- Compliance outbox drainer: grant SELECT on audit_events.
--
-- The drainer computes the per-tenant hash chain by reading the current
-- chain head (`SELECT event_hash FROM compliance.audit_events WHERE
-- tenant_id = … ORDER BY … LIMIT 1`, compliance-outbox-drainer.ts) before
-- INSERTing the next event. 0070 granted INSERT but not SELECT, so every
-- drain attempt fails with "permission denied for table audit_events" and
-- the outbox backlog grows (observed on dev: all events since 2026-05-07
-- stuck with that drainer_error). Read access to the append-only log does
-- not weaken the immutability boundary — DELETE/TRUNCATE/UPDATE remain
-- ungranted and the U1 triggers still apply.
--
-- Hand-rolled (drizzle meta journal is not in use for this change);
-- apply with: psql "$DATABASE_URL" -f drizzle/0222_compliance_drainer_select_audit_events.sql
-- creates: public._noop_marker_0222 (grants-only migration; marker view for the drift reporter)

GRANT SELECT ON compliance.audit_events TO compliance_drainer;

-- Drift-reporter marker: grants aren't introspectable via the reporter's
-- object checks, so declare a tiny marker view it can verify.
CREATE OR REPLACE VIEW public._noop_marker_0222 AS SELECT 1 AS applied;
