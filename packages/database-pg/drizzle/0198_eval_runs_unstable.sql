-- Purpose: eval_runs.unstable — count of unstable CASE verdicts on a run
--          (Eval Profiles U4, KTD4). `unstable` is a case-level aggregate
--          verdict from the evals-core trial-aggregation layer (scored
--          trials splitting with no majority); it is excluded from the
--          pass-rate denominator and gate math exactly like `error` and
--          surfaced as its own counter. Nullable: null on legacy runs
--          (null scoring_version) and on runs finalized before this
--          column shipped; versioned summarizers write it alongside
--          passed/failed/errored.
-- Plan: docs/plans/2026-07-01-002-feat-eval-profiles-plan.md (U4)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0198_eval_runs_unstable.sql
--
-- Hand-rolled (NOT registered in meta/_journal.json — repo convention is
-- psql-applied files gated by the db:migrate-manual drift reporter).
--
-- creates-column: public.eval_runs.unstable

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.eval_runs
  ADD COLUMN IF NOT EXISTS unstable integer;

COMMIT;
