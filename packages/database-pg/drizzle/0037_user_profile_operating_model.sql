-- Activation Agent operating-model profile columns.
--
-- Plan:
--   docs/plans/2026-04-26-001-feat-agent-activation-operating-model-plan.md
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0037_user_profile_operating_model.sql
--
-- Purely additive nullable/defaulted columns on user_profiles.
--
-- creates-column: public.user_profiles.operating_model
-- creates-column: public.user_profiles.operating_model_history

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
BEGIN
  IF to_regclass('public.user_profiles') IS NULL THEN
    RAISE EXCEPTION 'public.user_profiles does not exist';
  END IF;
END $$;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS operating_model jsonb;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS operating_model_history jsonb[] NOT NULL DEFAULT '{}'::jsonb[];

COMMIT;
