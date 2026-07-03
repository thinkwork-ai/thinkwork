-- Purpose: add the durable turn→triggering-message link that backs the
-- per-message dispatch indicator (plan 2026-07-03-003 U6, R6/R7, KTD3). A
-- non-null value is the id of the USER message whose send dispatched this
-- turn; the web UI pairs turns to messages by this id and falls back to
-- today's timestamp pairing for legacy (null) rows. Stamped by BOTH dispatch
-- handlers — chat-agent-invoke (direct invoke) and wakeup-processor (fallback
-- / mention / resume) — from the messageId already carried on every dispatch
-- payload.
--
-- Schema-only change matching src/schema/scheduled-jobs.ts
-- (thread_turns.triggering_message_id uuid, nullable). NO foreign key: turns
-- may outlive the message row, and the sibling thread_id column on this table
-- is likewise an un-referenced uuid — matched here. db:generate could not emit
-- a journaled migration (the drizzle snapshot in meta/ is frozen ~180
-- migrations behind HEAD; every recent schema change is a hand-rolled file
-- plus a deploy.yml step), so this follows that established convention
-- (precedent: 0203_threads_mode_override.sql).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS is a no-op if the column exists. Safe
-- to re-run.
--
-- Apply manually (verification pass before merge):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
--     -f packages/database-pg/drizzle/0204_thread_turns_triggering_message_id.sql
--
-- creates-column: public.thread_turns.triggering_message_id

\set ON_ERROR_STOP on

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('thread_turns_triggering_message_id_0204'));

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF to_regclass('public.thread_turns') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.thread_turns does not exist';
  END IF;
END $$;

-- Add the nullable triggering-message link. Idempotent.
ALTER TABLE public.thread_turns
  ADD COLUMN IF NOT EXISTS triggering_message_id uuid;

COMMIT;
