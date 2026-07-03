-- Purpose: schema substrate for deterministic git-backed routines
-- (plan 2026-07-03-004 U1, KTD-1/KTD-7/KTD-11).
--
--   1. routines.engine CHECK gains 'git_python'.
--   2. routines gains git_python-only pointer columns (module_path,
--      fixture_paths, credential_refs, validated_sha, disabled_reason).
--      Code itself never lives in the DB (R1) — the tenant GitHub repo is
--      the single source of truth.
--   3. routine_executions gains commit_sha / validated_sha / cache_served
--      (every git run answers "what exactly ran?", R4/R6) and relaxes
--      state_machine_arn + sfn_execution_arn to nullable — git_python
--      executions have no Step Functions involvement. The unique index on
--      sfn_execution_arn is NULL-tolerant in Postgres.
--   4. New routine_code_cache table — DB index over the S3 read-through
--      code cache keyed by commit SHA; authoritative for "validated SHA
--      per routine".
--   5. New routine_repair_events table — durable repair-ladder history
--      backing the visible repair log.
--
-- Schema-only change matching src/schema/{routines,routine-executions,
-- routine-code-cache,routine-repair-events}.ts. db:generate cannot emit a
-- journaled migration (the drizzle snapshot in meta/ is frozen ~180
-- migrations behind HEAD); hand-rolled per convention
-- (precedent: 0203_threads_mode_override.sql).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS /
-- CREATE INDEX IF NOT EXISTS; constraint changes guarded by pg_constraint
-- lookups; DROP NOT NULL is a no-op when already nullable. Safe to re-run.
--
-- Apply manually (verification pass before merge):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
--     -f packages/database-pg/drizzle/0205_routines_git_python.sql
--
-- creates-column: public.routines.module_path
-- creates-column: public.routines.fixture_paths
-- creates-column: public.routines.credential_refs
-- creates-column: public.routines.validated_sha
-- creates-column: public.routines.disabled_reason
-- creates-column: public.routine_executions.commit_sha
-- creates-column: public.routine_executions.validated_sha
-- creates-column: public.routine_executions.cache_served
-- creates: public.routine_code_cache
-- creates: public.routine_repair_events
-- creates: public.idx_routine_code_cache_routine_sha
-- creates: public.idx_routine_code_cache_tenant
-- creates: public.idx_routine_repair_events_routine_created
-- creates: public.idx_routine_repair_events_tenant
-- creates-constraint: public.routine_code_cache.routine_code_cache_fixture_status_enum
-- creates-constraint: public.routine_repair_events.routine_repair_events_event_type_enum

\set ON_ERROR_STOP on

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('routines_git_python_0205'));

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF to_regclass('public.routines') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.routines does not exist';
  END IF;
  IF to_regclass('public.routine_executions') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.routine_executions does not exist';
  END IF;
END $$;

-- 1. Extend the engine CHECK to admit 'git_python'. Drop + re-add under
--    the same name; guarded so re-runs are no-ops once the new definition
--    is in place.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'routines_engine_enum'
      AND conrelid = 'public.routines'::regclass
      AND pg_get_constraintdef(oid) NOT LIKE '%git_python%'
  ) THEN
    ALTER TABLE public.routines DROP CONSTRAINT routines_engine_enum;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'routines_engine_enum'
      AND conrelid = 'public.routines'::regclass
  ) THEN
    ALTER TABLE public.routines
      ADD CONSTRAINT routines_engine_enum
      CHECK (engine IN ('legacy_python', 'step_functions', 'git_python'));
  END IF;
END $$;

-- 2. git_python pointer columns on routines. All nullable (null on
--    legacy_python / step_functions rows).
ALTER TABLE public.routines
  ADD COLUMN IF NOT EXISTS module_path text,
  ADD COLUMN IF NOT EXISTS fixture_paths jsonb,
  ADD COLUMN IF NOT EXISTS credential_refs jsonb,
  ADD COLUMN IF NOT EXISTS validated_sha text,
  ADD COLUMN IF NOT EXISTS disabled_reason text;

-- 3. git_python execution columns + relax SFN-only NOT NULLs.
ALTER TABLE public.routine_executions
  ADD COLUMN IF NOT EXISTS commit_sha text,
  ADD COLUMN IF NOT EXISTS validated_sha text,
  ADD COLUMN IF NOT EXISTS cache_served boolean;

ALTER TABLE public.routine_executions
  ALTER COLUMN state_machine_arn DROP NOT NULL,
  ALTER COLUMN sfn_execution_arn DROP NOT NULL;

-- 4. routine_code_cache — S3 SHA-cache index (S3 canonical, DB derived).
CREATE TABLE IF NOT EXISTS public.routine_code_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  routine_id uuid NOT NULL REFERENCES public.routines(id),
  sha text NOT NULL,
  s3_key text NOT NULL,
  fixture_status text NOT NULL DEFAULT 'pending',
  fixture_result_json text,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  validated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_routine_code_cache_routine_sha
  ON public.routine_code_cache (routine_id, sha);
CREATE INDEX IF NOT EXISTS idx_routine_code_cache_tenant
  ON public.routine_code_cache (tenant_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'routine_code_cache_fixture_status_enum'
      AND conrelid = 'public.routine_code_cache'::regclass
  ) THEN
    ALTER TABLE public.routine_code_cache
      ADD CONSTRAINT routine_code_cache_fixture_status_enum
      CHECK (fixture_status IN ('pending', 'green', 'red'));
  END IF;
END $$;

-- 5. routine_repair_events — repair-ladder history (visible repair log).
CREATE TABLE IF NOT EXISTS public.routine_repair_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  routine_id uuid NOT NULL REFERENCES public.routines(id),
  execution_id uuid REFERENCES public.routine_executions(id),
  event_type text NOT NULL,
  thread_ref text,
  from_sha text,
  to_sha text,
  gate_result text,
  envelope_verdict text,
  budget_snapshot integer,
  detail_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_routine_repair_events_routine_created
  ON public.routine_repair_events (routine_id, created_at);
CREATE INDEX IF NOT EXISTS idx_routine_repair_events_tenant
  ON public.routine_repair_events (tenant_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'routine_repair_events_event_type_enum'
      AND conrelid = 'public.routine_repair_events'::regclass
  ) THEN
    ALTER TABLE public.routine_repair_events
      ADD CONSTRAINT routine_repair_events_event_type_enum
      CHECK (event_type IN ('retry', 'revert', 'repair_attempt', 'pending_commit', 'disabled', 'infra_failure'));
  END IF;
END $$;

COMMIT;
