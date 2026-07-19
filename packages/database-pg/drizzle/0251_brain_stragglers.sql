-- 0251_brain_stragglers.sql
--
-- Phase A of the brain-straggler move (THINK-290 U3). Moves the three
-- remaining public brain-domain tables into the existing `brain.*` Postgres
-- schema, drops the redundant prefixes from table, index, and constraint
-- names, and creates compat views in public.* so old bundled Lambda code
-- keeps reading during the deploy bridge window.
--
-- Tables moved:
--   public.brain_dream_runs       → brain.dream_runs
--   public.brain_dream_actions    → brain.dream_actions
--   public.memory_retain_attempts → brain.retain_attempts
--
-- Unlike the kg tables (whose idx_kg_* names were already schema-shorthand),
-- these indexes embed the old table names, so they are renamed to the new
-- stems. FK constraint names keep their original prefixes — cosmetic cleanup
-- deferred, same as the 0089/0090/0250 precedent.
--
-- Writers that cannot go through compat views (ON CONFLICT is rejected at
-- parse time): the dream ledger (raw ON CONFLICT on dream_runs.dedupe_key
-- and dream_actions (run_id, ordinal)) and memory-retain's
-- onConflictDoUpdate on retain_attempts. The apply runbook pauses the
-- brain-dream-state schedule AND the memory-retain Lambda (reserved
-- concurrency 0) for the apply→redeploy window — see the PR body.
--
-- Analyst surface: these tables leave SCHEMA.md and the 0227/0230 generated
-- grant/RLS blocks (analyst model is public-only by design, THINK-283).
--
-- Plan reference: docs/plans/2026-07-14-001-refactor-kg-schema-extraction-and-brain-cleanup-plan.md
-- Pattern doc:    docs/solutions/database-issues/feature-schema-extraction-pattern.md
--
-- Apply manually (pause the dream schedule + memory-retain first):
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0251_brain_stragglers.sql
-- Then verify:
--   bash scripts/db-migrate-manual.sh packages/database-pg/drizzle/0251_brain_stragglers.sql
--   psql -c "\dt brain.dream_runs brain.dream_actions brain.retain_attempts"
--   psql -c "\dv public.brain_dream_* public.memory_retain_attempts"  -- 3 compat views
--
-- Inverse runbook (rollback): drop the 3 views, SET SCHEMA back, RENAME
-- tables/indexes/constraints back to the prefixed names (leaf-first:
-- dream_actions before dream_runs), then nothing else — no functions
-- reference these tables.
--
-- Markers (consumed by scripts/db-migrate-manual.sh):
--
-- moves-owner: public.brain_dream_runs -> brain.dream_runs
-- moves-owner: public.brain_dream_actions -> brain.dream_actions
-- moves-owner: public.memory_retain_attempts -> brain.retain_attempts
-- drops: public.brain_dream_runs_dedupe_key_uidx
-- drops: public.brain_dream_runs_tenant_bank_idx
-- drops: public.brain_dream_runs_tenant_status_idx
-- drops: public.brain_dream_actions_run_ordinal_uidx
-- drops: public.brain_dream_actions_run_status_idx
-- drops: public.memory_retain_attempts_source_event_uidx
-- drops: public.memory_retain_attempts_due_idx
-- drops: public.memory_retain_attempts_tenant_status_idx
-- drops: public.memory_retain_attempts_thread_idx
-- drops: public.memory_retain_attempts_user_idx
-- drops: public.memory_retain_attempts_space_idx
-- drops: public.memory_retain_attempts_turn_idx
-- drops-constraint: public.brain_dream_runs.brain_dream_runs_status_check
-- drops-constraint: public.brain_dream_actions.brain_dream_actions_type_check
-- drops-constraint: public.brain_dream_actions.brain_dream_actions_status_check
-- drops-constraint: public.memory_retain_attempts.memory_retain_attempts_status_allowed
-- drops-constraint: public.memory_retain_attempts.memory_retain_attempts_attempt_count_nonnegative
-- drops-constraint: public.memory_retain_attempts.memory_retain_attempts_max_attempts_positive
-- creates: brain.dream_runs
-- creates: brain.dream_actions
-- creates: brain.retain_attempts
-- creates: brain.dream_runs_dedupe_key_uidx
-- creates: brain.dream_runs_tenant_bank_idx
-- creates: brain.dream_runs_tenant_status_idx
-- creates: brain.dream_actions_run_ordinal_uidx
-- creates: brain.dream_actions_run_status_idx
-- creates: brain.retain_attempts_source_event_uidx
-- creates: brain.retain_attempts_due_idx
-- creates: brain.retain_attempts_tenant_status_idx
-- creates: brain.retain_attempts_thread_idx
-- creates: brain.retain_attempts_user_idx
-- creates: brain.retain_attempts_space_idx
-- creates: brain.retain_attempts_turn_idx
-- creates-constraint: brain.dream_runs.dream_runs_status_check
-- creates-constraint: brain.dream_actions.dream_actions_type_check
-- creates-constraint: brain.dream_actions.dream_actions_status_check
-- creates-constraint: brain.retain_attempts.retain_attempts_status_allowed
-- creates-constraint: brain.retain_attempts.retain_attempts_attempt_count_nonnegative
-- creates-constraint: brain.retain_attempts.retain_attempts_max_attempts_positive
-- creates: public.brain_dream_runs
-- creates: public.brain_dream_actions
-- creates: public.memory_retain_attempts

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '300s';

SELECT pg_advisory_xact_lock(hashtext('brain_stragglers_extraction'));

DO $$
BEGIN
  IF current_database() != 'thinkwork' THEN
    RAISE EXCEPTION 'wrong database: %, expected thinkwork', current_database();
  END IF;
END $$;

-- Pre-flight: the brain schema itself must exist (created by 0090).
DO $$
BEGIN
  IF to_regnamespace('brain') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: brain schema does not exist — apply 0090 first';
  END IF;
END $$;

-- Pre-flight invariants, with a clean short-circuit when already applied so
-- the customer runner's unattended re-sweep is a no-op.
DO $$
BEGIN
  IF to_regclass('brain.dream_runs') IS NOT NULL
     AND to_regclass('brain.dream_actions') IS NOT NULL
     AND to_regclass('brain.retain_attempts') IS NOT NULL
     AND to_regclass('public.brain_dream_runs') IS NOT NULL THEN
    RETURN;  -- already applied (views present at the old names)
  END IF;

  IF to_regclass('public.brain_dream_runs') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.brain_dream_runs does not exist';
  END IF;
  IF to_regclass('brain.dream_runs') IS NOT NULL THEN
    RAISE EXCEPTION 'pre-flight: brain.dream_runs already exists — refusing to re-apply';
  END IF;
  IF to_regclass('public.brain_dream_actions') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.brain_dream_actions does not exist';
  END IF;
  IF to_regclass('brain.dream_actions') IS NOT NULL THEN
    RAISE EXCEPTION 'pre-flight: brain.dream_actions already exists — refusing to re-apply';
  END IF;
  IF to_regclass('public.memory_retain_attempts') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.memory_retain_attempts does not exist';
  END IF;
  IF to_regclass('brain.retain_attempts') IS NOT NULL THEN
    RAISE EXCEPTION 'pre-flight: brain.retain_attempts already exists — refusing to re-apply';
  END IF;
END $$;

-- ── Move and rename tables (leaf-first: dream_actions FKs dream_runs) ────

DO $$
BEGIN
  IF to_regclass('public.brain_dream_actions') IS NOT NULL
     AND to_regclass('brain.dream_actions') IS NULL THEN
    ALTER TABLE public.brain_dream_actions SET SCHEMA brain;
    ALTER TABLE brain.brain_dream_actions RENAME TO dream_actions;
  END IF;

  IF to_regclass('public.brain_dream_runs') IS NOT NULL
     AND to_regclass('brain.dream_runs') IS NULL THEN
    ALTER TABLE public.brain_dream_runs SET SCHEMA brain;
    ALTER TABLE brain.brain_dream_runs RENAME TO dream_runs;
  END IF;

  IF to_regclass('public.memory_retain_attempts') IS NOT NULL
     AND to_regclass('brain.retain_attempts') IS NULL THEN
    ALTER TABLE public.memory_retain_attempts SET SCHEMA brain;
    ALTER TABLE brain.memory_retain_attempts RENAME TO retain_attempts;
  END IF;
END $$;

-- ── Rename indexes to the new stems ─────────────────────────────────────

DO $$
DECLARE
  pair record;
BEGIN
  FOR pair IN
    SELECT * FROM (VALUES
      ('brain_dream_runs_dedupe_key_uidx',            'dream_runs_dedupe_key_uidx'),
      ('brain_dream_runs_tenant_bank_idx',            'dream_runs_tenant_bank_idx'),
      ('brain_dream_runs_tenant_status_idx',          'dream_runs_tenant_status_idx'),
      ('brain_dream_actions_run_ordinal_uidx',        'dream_actions_run_ordinal_uidx'),
      ('brain_dream_actions_run_status_idx',          'dream_actions_run_status_idx'),
      ('memory_retain_attempts_source_event_uidx',    'retain_attempts_source_event_uidx'),
      ('memory_retain_attempts_due_idx',              'retain_attempts_due_idx'),
      ('memory_retain_attempts_tenant_status_idx',    'retain_attempts_tenant_status_idx'),
      ('memory_retain_attempts_thread_idx',           'retain_attempts_thread_idx'),
      ('memory_retain_attempts_user_idx',             'retain_attempts_user_idx'),
      ('memory_retain_attempts_space_idx',            'retain_attempts_space_idx'),
      ('memory_retain_attempts_turn_idx',             'retain_attempts_turn_idx')
    ) AS v(old_name, new_name)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'brain' AND c.relname = pair.old_name
    ) THEN
      EXECUTE format('ALTER INDEX brain.%I RENAME TO %I',
                     pair.old_name, pair.new_name);
    END IF;
  END LOOP;
END $$;

-- ── Rename CHECK constraints to the new stems ───────────────────────────

DO $$
DECLARE
  pair record;
BEGIN
  FOR pair IN
    SELECT * FROM (VALUES
      ('brain.dream_runs',      'brain_dream_runs_status_check',                     'dream_runs_status_check'),
      ('brain.dream_actions',   'brain_dream_actions_type_check',                    'dream_actions_type_check'),
      ('brain.dream_actions',   'brain_dream_actions_status_check',                  'dream_actions_status_check'),
      ('brain.retain_attempts', 'memory_retain_attempts_status_allowed',             'retain_attempts_status_allowed'),
      ('brain.retain_attempts', 'memory_retain_attempts_attempt_count_nonnegative',  'retain_attempts_attempt_count_nonnegative'),
      ('brain.retain_attempts', 'memory_retain_attempts_max_attempts_positive',      'retain_attempts_max_attempts_positive')
    ) AS v(tbl, old_name, new_name)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = to_regclass(pair.tbl) AND conname = pair.old_name
    ) THEN
      EXECUTE format('ALTER TABLE %s RENAME CONSTRAINT %I TO %I',
                     pair.tbl, pair.old_name, pair.new_name);
    END IF;
  END LOOP;
END $$;

-- ── Compat views in public.* ────────────────────────────────────────────
-- Column-enumerated per R6. No generated columns on any of the three
-- tables. The dream ledger's raw ON CONFLICT and memory-retain's
-- onConflictDoUpdate cannot pass through views — both writers are paused
-- for the window per the runbook. The U4 PR drops these.

DO $$
BEGIN
  IF to_regclass('public.brain_dream_runs') IS NULL THEN
    CREATE VIEW public.brain_dream_runs AS
      SELECT id, tenant_id, bank_id, dedupe_key, status, planned_counts,
             applied_counts, error_message, started_at, finished_at,
             created_at, updated_at
      FROM brain.dream_runs;
  END IF;

  IF to_regclass('public.brain_dream_actions') IS NULL THEN
    CREATE VIEW public.brain_dream_actions AS
      SELECT id, run_id, ordinal, action_type, status, target, reason,
             applied_at, error_message, created_at
      FROM brain.dream_actions;
  END IF;

  IF to_regclass('public.memory_retain_attempts') IS NULL THEN
    CREATE VIEW public.memory_retain_attempts AS
      SELECT id, tenant_id, user_id, space_id, thread_id, thread_turn_id,
             source_event_key, source_event_type, provider, status,
             attempt_count, max_attempts, next_retry_at, locked_at,
             locked_by, started_at, finished_at, backend_latency_ms,
             provider_document_id, provider_result, error_class,
             error_message, metadata, created_at, updated_at
      FROM brain.retain_attempts;
  END IF;
END $$;

COMMIT;
