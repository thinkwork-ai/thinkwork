-- Purpose: operator verdict override (Evaluations Trust Core U9). An
--          operator can overturn a wrong judge verdict; the override is
--          a SEPARATE field, never a mutation of `status` — the judge's
--          original verdict + rendered rubric stay immutable on the row
--          while aggregation reads the override last
--          (effective = override_status ?? status).
-- Plan: docs/plans/2026-06-12-003-feat-evaluations-trust-core-plan.md (U9)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0162_eval_result_override.sql
--
-- Hand-rolled (NOT registered in meta/_journal.json — the journal snapshot
-- stopped at 0020; repo convention is psql-applied files gated by the
-- db:migrate-manual drift reporter).
--
-- All columns are additive and nullable with NO defaults — null is
-- semantically load-bearing:
--   * eval_results.override_status NULL => no override; the judge's
--     verdict stands. Non-null: 'pass' | 'fail' (enum-by-comment) —
--     only scored rows (status pass|fail) may carry one; error rows
--     are rejected at the mutation.
--   * eval_results.overridden_by   => authenticated caller identity,
--     derived server-side (never an argument).
--   * eval_results.overridden_at   => when the override was written
--     (last-write posture; no history table in v1).
--   * eval_results.override_reason => required non-empty audit note.
--
-- creates-column: public.eval_results.override_status
-- creates-column: public.eval_results.overridden_by
-- creates-column: public.eval_results.overridden_at
-- creates-column: public.eval_results.override_reason

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.eval_results
  ADD COLUMN IF NOT EXISTS override_status text;

ALTER TABLE public.eval_results
  ADD COLUMN IF NOT EXISTS overridden_by text;

ALTER TABLE public.eval_results
  ADD COLUMN IF NOT EXISTS overridden_at timestamptz;

ALTER TABLE public.eval_results
  ADD COLUMN IF NOT EXISTS override_reason text;

COMMIT;
