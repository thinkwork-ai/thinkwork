-- Artifacts carry the generating user directly: created_by_user_id is
-- stamped at creation (source thread's owner, or the acting caller) so list
-- surfaces resolve the User column without a thread join. Nullable: system
-- jobs with no user context. The backfill below covers all pre-existing rows
-- reachable through their source thread. Additive — safe to apply ahead of
-- code deploy.
--
-- Hand-rolled (drizzle meta journal is not in use for this change);
-- apply with: psql "$DATABASE_URL" -f drizzle/0220_artifacts_created_by_user.sql
-- creates-column: public.artifacts.created_by_user_id

ALTER TABLE public.artifacts
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES public.users(id);

-- Backfill existing artifacts from their source thread's owner.
UPDATE public.artifacts a
SET created_by_user_id = t.user_id
FROM public.threads t
WHERE a.thread_id = t.id
  AND a.created_by_user_id IS NULL
  AND t.user_id IS NOT NULL;
