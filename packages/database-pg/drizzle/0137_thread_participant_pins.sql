-- Purpose: persist per-user saved Thread pins across Spaces clients.
-- Plan: docs/plans/2026-05-28-002-feat-server-thread-pins-plan.md (U1)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0137_thread_participant_pins.sql
-- creates-column: public.thread_participants.pinned_at
-- creates-column: public.thread_participants.pin_order
-- creates: public.idx_thread_participants_user_pins

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.thread_participants
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz,
  ADD COLUMN IF NOT EXISTS pin_order integer;

CREATE INDEX IF NOT EXISTS idx_thread_participants_user_pins
  ON public.thread_participants (tenant_id, user_id, pin_order)
  WHERE participant_type = 'user'
    AND user_id IS NOT NULL
    AND pinned_at IS NOT NULL;

COMMIT;
