-- THINK-302 U7 (R28/KTD-14): run-as identity for wakeup/scheduled turns.
--
-- The user a scheduled/wakeup turn runs AS, so it composes that user's +
-- the run-in-space's capability scopes. A job with no run_as_user_id
-- compiles root + sub-agent only — it NEVER inherits the creator's grants.
-- Set/cleared only through an authorized surface (KTD-14 save-time authz);
-- dispatch-time revalidation drops stale grants.
--
-- Additive, idempotent nullable-FK column add (ON DELETE SET NULL so a
-- deactivated user's jobs degrade to root-only rather than break).
-- Hand-rolled only to carry the drift-gate marker; db:push would also add it.
--
-- Apply manually:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0260_scheduled_jobs_run_as_user.sql
-- creates-column: public.scheduled_jobs.run_as_user_id

\set ON_ERROR_STOP on

ALTER TABLE public.scheduled_jobs
  ADD COLUMN IF NOT EXISTS run_as_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL;
