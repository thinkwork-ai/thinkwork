-- Purpose: twin graph projector consumer state (Company Brain U5 / KTD-4) —
--   per-tenant cursor over identity.entity_resolution_events. The cursor is
--   the source of truth for the projector; nudge invokes are latency only.
-- Plan: docs/plans/2026-07-21-001-feat-company-brain-digital-twin-plan.md (U5)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0272_identity_graph_projection_cursor.sql
-- creates: identity.graph_projection_cursors

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS identity.graph_projection_cursors (
    tenant_id             UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
    last_event_created_at TIMESTAMPTZ,
    last_event_id         UUID,
    last_snapshot_cursor  TEXT,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
