-- Purpose: add per-Space cold-contact email trigger opt-in.
-- Plan: docs/plans/2026-05-22-002-feat-spaces-runtime-renderer-and-channels-plan.md (U4)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0122_space_email_triggers.sql
-- creates-column: public.spaces.email_triggers_enabled

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.spaces
  ADD COLUMN IF NOT EXISTS email_triggers_enabled boolean;

UPDATE public.spaces
SET email_triggers_enabled = false
WHERE email_triggers_enabled IS NULL;

ALTER TABLE public.spaces
  ALTER COLUMN email_triggers_enabled SET DEFAULT false,
  ALTER COLUMN email_triggers_enabled SET NOT NULL;

COMMIT;
