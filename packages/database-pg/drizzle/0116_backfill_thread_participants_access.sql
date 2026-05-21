-- Purpose: backfill user Thread participants for per-user Thread visibility.
-- Context: a user may read a Thread only when they started it (`threads.user_id`)
-- or were mentioned in it (`message_mentions target_type='user'`).
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0116_backfill_thread_participants_access.sql
-- creates: public.view_thread_participants_access_backfilled

\set ON_ERROR_STOP on

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('thread_participants_access_backfill_0116'));

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
  IF to_regclass('public.message_mentions') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.message_mentions does not exist';
  END IF;
END $$;

-- Threads started by a user. Preserve legacy thread-level read state so
-- existing owners do not suddenly see old conversations as unread.
INSERT INTO public.thread_participants (
  tenant_id,
  thread_id,
  space_id,
  participant_type,
  user_id,
  role,
  source,
  notification_preference,
  last_read_at,
  created_at,
  updated_at
)
SELECT
  t.tenant_id,
  t.id,
  t.space_id,
  'user',
  t.user_id,
  CASE
    WHEN t.created_by_id = t.user_id::text THEN 'requester'
    ELSE 'member'
  END,
  'thread_owner_backfill',
  'subscribed',
  t.last_read_at,
  COALESCE(t.created_at, now()),
  now()
FROM public.threads t
JOIN public.users u
  ON u.id = t.user_id
 AND u.tenant_id = t.tenant_id
WHERE t.user_id IS NOT NULL
  AND t.space_id IS NOT NULL
ON CONFLICT (tenant_id, thread_id, user_id)
  WHERE user_id IS NOT NULL
DO UPDATE SET
  role = CASE
    WHEN public.thread_participants.role = 'member'
      AND EXCLUDED.role = 'requester'
    THEN 'requester'
    ELSE public.thread_participants.role
  END,
  last_read_at = COALESCE(public.thread_participants.last_read_at, EXCLUDED.last_read_at),
  updated_at = now();

-- Users mentioned in any existing message become Thread participants.
-- Mention rows are the durable record that grants access to non-owners.
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
  mm.tenant_id,
  mm.thread_id,
  t.space_id,
  'user',
  mm.target_id,
  'member',
  'mention_backfill',
  'subscribed',
  MIN(mm.created_at),
  now()
FROM public.message_mentions mm
JOIN public.threads t
  ON t.id = mm.thread_id
 AND t.tenant_id = mm.tenant_id
JOIN public.users u
  ON u.id = mm.target_id
 AND u.tenant_id = mm.tenant_id
WHERE mm.target_type = 'user'
  AND t.space_id IS NOT NULL
GROUP BY mm.tenant_id, mm.thread_id, t.space_id, mm.target_id
ON CONFLICT (tenant_id, thread_id, user_id)
  WHERE user_id IS NOT NULL
DO NOTHING;

CREATE OR REPLACE VIEW public.view_thread_participants_access_backfilled AS
SELECT
  COUNT(*) FILTER (WHERE source = 'thread_owner_backfill')::int AS owner_backfill_rows,
  COUNT(*) FILTER (WHERE source = 'mention_backfill')::int AS mention_backfill_rows,
  now() AS checked_at
FROM public.thread_participants;

COMMENT ON VIEW public.view_thread_participants_access_backfilled IS
  'Drift marker and summary for 0116_backfill_thread_participants_access.sql.';

COMMIT;
