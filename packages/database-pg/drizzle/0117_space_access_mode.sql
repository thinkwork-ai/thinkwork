-- Purpose: add tenant-public/private access semantics to Spaces.
-- Plan: docs/plans/2026-05-21-001-feat-public-private-space-access-plan.md (U1)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0117_space_access_mode.sql
-- creates-column: public.spaces.access_mode
-- creates-constraint: public.spaces.spaces_access_mode_allowed

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.spaces
  ADD COLUMN IF NOT EXISTS access_mode text;

UPDATE public.spaces
SET access_mode = 'public'
WHERE access_mode IS NULL;

ALTER TABLE public.spaces
  ALTER COLUMN access_mode SET DEFAULT 'public',
  ALTER COLUMN access_mode SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'spaces_access_mode_allowed'
      AND conrelid = 'public.spaces'::regclass
  ) THEN
    ALTER TABLE public.spaces
      ADD CONSTRAINT spaces_access_mode_allowed
      CHECK (access_mode IN ('public','private'));
  END IF;
END;
$$;

COMMIT;
