-- Purpose: add participant-scoped read state for collaborative Space Threads.
-- Plan: docs/plans/2026-05-19-005-feat-spaces-collaborative-chat-ui-plan.md (U1)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0110_thread_participant_read_state.sql
-- creates-column: public.thread_participants.last_read_at
-- creates: public.idx_thread_participants_user_unread

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.thread_participants
  ADD COLUMN IF NOT EXISTS last_read_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_thread_participants_user_unread
  ON public.thread_participants (tenant_id, user_id, last_read_at)
  WHERE participant_type = 'user' AND user_id IS NOT NULL;

COMMIT;
