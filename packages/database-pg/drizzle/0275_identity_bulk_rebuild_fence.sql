-- Purpose: bulk-rebuild lane fence + extract-time watermark (THINK-331) —
--   per-tenant CAS fence on the projector cursor row. bulk_load_started_at
--   non-null = a bulk-rebuild holds the fence (heartbeat, refreshed on every
--   resume/poll); bulk_load_id is the Neptune loader job id (null until the
--   loader starts). The watermark pair is captured SQL-side BEFORE the
--   Postgres extract so the success tail fast-forwards the cursor only past
--   events the extract reflected — events committed during the load window
--   replay through the nudge lane. Additive-only; lands before the code that
--   reads it (safe ordering).
-- Plan: docs/plans/2026-07-22-004-feat-identity-projector-bulk-rebuild-plan.md (U2)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0275_identity_bulk_rebuild_fence.sql
-- creates-column: identity.graph_projection_cursors.bulk_load_id
-- creates-column: identity.graph_projection_cursors.bulk_load_started_at
-- creates-column: identity.graph_projection_cursors.bulk_watermark_created_at
-- creates-column: identity.graph_projection_cursors.bulk_watermark_event_id

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE identity.graph_projection_cursors
    ADD COLUMN IF NOT EXISTS bulk_load_id              TEXT,
    ADD COLUMN IF NOT EXISTS bulk_load_started_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS bulk_watermark_created_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS bulk_watermark_event_id   UUID;

COMMIT;
