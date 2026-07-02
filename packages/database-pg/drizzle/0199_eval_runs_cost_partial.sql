-- Purpose: eval_runs.cost_partial — cost-honesty flag on a run's summary
--          (Eval Profiles U5, R6). True when any result row is missing a
--          priced agent-turn cost (agent usage absent — older runtime
--          envelope or an errored invoke — or usage recorded but catalog
--          pricing unresolved, agent_cost_usd null). cost_usd then
--          understates the true spend and must render as partial — never
--          as a confident total and never as a false zero. Nullable: null
--          on runs finalized before this column shipped (their cost is
--          evaluator-only, i.e. partial — the API maps null to true).
-- Plan: docs/plans/2026-07-01-002-feat-eval-profiles-plan.md (U5)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0199_eval_runs_cost_partial.sql
--
-- Hand-rolled (NOT registered in meta/_journal.json — repo convention is
-- psql-applied files gated by the db:migrate-manual drift reporter).
--
-- creates-column: public.eval_runs.cost_partial

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.eval_runs
  ADD COLUMN IF NOT EXISTS cost_partial boolean;

COMMIT;
