-- Purpose: honest eval aggregation (Evaluations Trust Core U2) — errors leave
--          the pass rate. eval_runs gains an `errored` counter plus the
--          scoring-semantics stamps, eval_results gains an error cause subtag.
-- Plan: docs/plans/2026-06-12-003-feat-evaluations-trust-core-plan.md (U2)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0159_eval_scoring_version.sql
--
-- Hand-rolled (NOT registered in meta/_journal.json — the journal snapshot
-- stopped at 0020; repo convention is psql-applied files gated by the
-- db:migrate-manual drift reporter).
--
-- All columns are additive and nullable with NO defaults — null is
-- semantically load-bearing:
--   * eval_runs.scoring_version NULL  => legacy run (~v1 semantics: errors
--     fold into `failed`); never recomputed under new semantics.
--   * eval_runs.errored NULL          => counter not produced (legacy runs).
--   * eval_runs.summary_scoring_version NULL => summary written by
--     pre-stamp code; read path/reconciler recompute when it diverges from
--     the run's stamped scoring_version.
--   * eval_results.error_cause: 'timeout' | 'throttle' | 'evaluator_error'
--     | 'reconciler' | 'infra_other' (enum-by-comment; NULL on pass/fail
--     rows and on pre-migration error rows).
--
-- creates-column: public.eval_runs.errored
-- creates-column: public.eval_runs.scoring_version
-- creates-column: public.eval_runs.summary_scoring_version
-- creates-column: public.eval_results.error_cause

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.eval_runs
  ADD COLUMN IF NOT EXISTS errored integer;

ALTER TABLE public.eval_runs
  ADD COLUMN IF NOT EXISTS scoring_version integer;

ALTER TABLE public.eval_runs
  ADD COLUMN IF NOT EXISTS summary_scoring_version integer;

ALTER TABLE public.eval_results
  ADD COLUMN IF NOT EXISTS error_cause text;

COMMIT;
