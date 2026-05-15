-- Hand-rolled — apply manually to dev via:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0088_compliance_event_types_finance_pilot.sql
--
-- See docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md
--
-- U6 of docs/plans/2026-05-14-002-feat-finance-analysis-pilot-plan.md.
-- Extends the event_type prefix CHECK constraints on compliance.audit_outbox
-- and compliance.audit_events to recognize three new finance-pilot event-type
-- families: attachment.*, skill.*, output.* — so attachment.received,
-- skill.activated, and output.artifact_produced can be inserted.
--
-- The new constraints are renamed *_v2 so the drift reporter at
-- scripts/db-migrate-manual.sh can verify application (probing by name).
-- The old *_prefix constraints are DROPped in the same transaction.
--
-- creates-constraint: compliance.audit_outbox.audit_outbox_event_type_prefix_v2
-- creates-constraint: compliance.audit_events.audit_events_event_type_prefix_v2

BEGIN;

ALTER TABLE compliance.audit_outbox
  DROP CONSTRAINT IF EXISTS audit_outbox_event_type_prefix;

ALTER TABLE compliance.audit_outbox
  ADD CONSTRAINT audit_outbox_event_type_prefix_v2 CHECK (
    event_type ~ '^(auth|user|agent|mcp|workspace|data|policy|approval|attachment|skill|output)\.'
  );

ALTER TABLE compliance.audit_events
  DROP CONSTRAINT IF EXISTS audit_events_event_type_prefix;

ALTER TABLE compliance.audit_events
  ADD CONSTRAINT audit_events_event_type_prefix_v2 CHECK (
    event_type ~ '^(auth|user|agent|mcp|workspace|data|policy|approval|attachment|skill|output)\.'
  );

COMMIT;
