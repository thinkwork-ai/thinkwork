-- Purpose: make thread_participants a truthful record of who is actually in a
-- thread, so Thread Mode derivation (plan 2026-07-03-003 U3) does not
-- misclassify already-multiplayer threads at ship time (R13, AE7), and so
-- non-space threads can carry participant rows at all (R14).
--
-- Two changes, applied atomically:
--   1. Schema: make thread_participants.space_id NULLABLE. Non-space threads
--      (no owning Space) get participant rows whose space_id is null. This is
--      the ALTER matching src/schema/thread-participants.ts (space_id no longer
--      .notNull()). db:generate could not emit a journaled migration here — the
--      drizzle snapshot (meta/) is frozen ~180 migrations behind HEAD and every
--      recent schema change is a hand-rolled file + deploy.yml step, so this
--      follows that established convention.
--   2. Data: backfill one participant row per (tenant, thread, distinct human
--      message sender) for existing threads, so reply-joiners who never got a
--      row are counted. Agent/system senders are excluded.
--
-- Idempotent: DROP NOT NULL is a no-op if already dropped; the INSERT uses
-- ON CONFLICT DO NOTHING against the partial unique index on
-- (tenant_id, thread_id, user_id). Re-running is safe.
--
-- Apply manually (verification pass before merge):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
--     -f packages/database-pg/drizzle/0202_backfill_thread_participants_from_senders.sql
--
-- creates: public.view_thread_participants_sender_backfilled

\set ON_ERROR_STOP on

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('thread_participants_sender_backfill_0202'));

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '180s';

DO $$
BEGIN
  IF to_regclass('public.thread_participants') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.thread_participants does not exist';
  END IF;
  IF to_regclass('public.threads') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.threads does not exist';
  END IF;
  IF to_regclass('public.messages') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.messages does not exist';
  END IF;
END $$;

-- 1. Non-space participation (R14): drop the NOT NULL on space_id so non-space
--    threads can carry rows. Idempotent.
ALTER TABLE public.thread_participants
  ALTER COLUMN space_id DROP NOT NULL;

-- 2. Backfill sender participation from distinct human message senders.
--    sender_type 'user'/'human' are the human sender labels; agent/system
--    senders are excluded so they never become participants. Joining users
--    guards the FK (thread_participants.user_id -> users.id) against any
--    orphaned sender_id. space_id rides from the thread and is null for
--    non-space threads.
INSERT INTO public.thread_participants (
  tenant_id,
  thread_id,
  space_id,
  participant_type,
  user_id,
  role,
  source,
  notification_preference,
  created_at,
  updated_at
)
SELECT
  m.tenant_id,
  m.thread_id,
  t.space_id,
  'user',
  m.sender_id,
  'member',
  'sender',
  'subscribed',
  MIN(m.created_at),
  now()
FROM public.messages m
JOIN public.threads t
  ON t.id = m.thread_id
 AND t.tenant_id = m.tenant_id
JOIN public.users u
  ON u.id = m.sender_id
 AND u.tenant_id = m.tenant_id
WHERE m.sender_type IN ('user', 'human')
  AND m.sender_id IS NOT NULL
GROUP BY m.tenant_id, m.thread_id, t.space_id, m.sender_id
ON CONFLICT (tenant_id, thread_id, user_id)
  WHERE user_id IS NOT NULL
DO NOTHING;

-- Drift marker + summary. Its presence is what the drift reporter probes; the
-- view only exists if the whole transaction (ALTER + backfill) committed.
CREATE OR REPLACE VIEW public.view_thread_participants_sender_backfilled AS
SELECT
  COUNT(*) FILTER (WHERE source = 'sender')::int AS sender_backfill_rows,
  COUNT(*) FILTER (WHERE space_id IS NULL)::int AS non_space_rows,
  now() AS checked_at
FROM public.thread_participants;

COMMENT ON VIEW public.view_thread_participants_sender_backfilled IS
  'Drift marker and summary for 0202_backfill_thread_participants_from_senders.sql.';

COMMIT;
