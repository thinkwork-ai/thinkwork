-- Hand-rolled — apply manually to dev via:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0160_compliance_event_types_plugins.sql
--
-- See docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md
--
-- U5 of docs/plans/2026-06-12-001-feat-application-plugins-plan.md.
-- Extends the event_type prefix CHECK constraints on compliance.audit_outbox
-- and compliance.audit_events to recognize the plugin.* event-type family —
-- so plugin.installed and plugin.uninstalled (and the U6 activation events
-- plugin.activation_granted / plugin.activation_revoked) can be inserted.
--
-- The new constraints are renamed *_v3 so the drift reporter at
-- scripts/db-migrate-manual.sh can verify application (probing by name).
-- The old *_v2 constraints are DROPped in the same transaction.
--
-- creates-constraint: compliance.audit_outbox.audit_outbox_event_type_prefix_v3
-- creates-constraint: compliance.audit_events.audit_events_event_type_prefix_v3

BEGIN;

ALTER TABLE compliance.audit_outbox
  DROP CONSTRAINT IF EXISTS audit_outbox_event_type_prefix_v2;

ALTER TABLE compliance.audit_outbox
  ADD CONSTRAINT audit_outbox_event_type_prefix_v3 CHECK (
    event_type ~ '^(auth|user|agent|mcp|workspace|data|policy|approval|attachment|skill|output|plugin)\.'
  );

ALTER TABLE compliance.audit_events
  DROP CONSTRAINT IF EXISTS audit_events_event_type_prefix_v2;

ALTER TABLE compliance.audit_events
  ADD CONSTRAINT audit_events_event_type_prefix_v3 CHECK (
    event_type ~ '^(auth|user|agent|mcp|workspace|data|policy|approval|attachment|skill|output|plugin)\.'
  );

COMMIT;
