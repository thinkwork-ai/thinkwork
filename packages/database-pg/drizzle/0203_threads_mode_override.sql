-- Purpose: add the per-thread Thread Mode override column that backs
-- server-authoritative Thread Mode (plan 2026-07-03-003 U3, R3). NULL means the
-- mode is derived from human participant count (0–1 → agent, 2+ →
-- multiplayer); a non-null value pins the mode for every participant until
-- changed. Set from the thread info panel via updateThread(modeOverride).
--
-- Schema-only change matching src/schema/threads.ts (threads.mode_override
-- text, CHECK IN ('agent','multiplayer')). db:generate could not emit a
-- journaled migration here — the drizzle snapshot (meta/) is frozen ~180
-- migrations behind HEAD and every recent schema change is a hand-rolled file
-- plus a deploy.yml step, so this follows that established convention
-- (precedent: 0202_backfill_thread_participants_from_senders.sql).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS is a no-op if the column exists; the
-- CHECK constraint is added only when absent (guarded by pg_constraint). Safe
-- to re-run.
--
-- Apply manually (verification pass before merge):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
--     -f packages/database-pg/drizzle/0203_threads_mode_override.sql
--
-- creates-column: public.threads.mode_override

\set ON_ERROR_STOP on

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('threads_mode_override_0203'));

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF to_regclass('public.threads') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.threads does not exist';
  END IF;
END $$;

-- 1. Add the nullable override column. Idempotent.
ALTER TABLE public.threads
  ADD COLUMN IF NOT EXISTS mode_override text;

-- 2. Constrain the allowed values. NULL is permitted (derived mode); non-null
--    must be one of the two modes. Added only when the named constraint does
--    not already exist so re-runs are no-ops.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'threads_mode_override_allowed'
      AND conrelid = 'public.threads'::regclass
  ) THEN
    ALTER TABLE public.threads
      ADD CONSTRAINT threads_mode_override_allowed
      CHECK (mode_override IS NULL OR mode_override IN ('agent','multiplayer'));
  END IF;
END $$;

COMMIT;
