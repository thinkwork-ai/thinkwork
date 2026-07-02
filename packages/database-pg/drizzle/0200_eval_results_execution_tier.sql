-- Purpose: eval_results.execution_tier — HOW the response was produced
--          (Eval Execution Tiers v1). 'agent' = full Pi turn via
--          AgentCore (workspace, tools, MCP); 'model' = one stateless
--          Bedrock Converse call with the run's pinned composed prompt.
--          An execution detail of the row, not a lifecycle: scoring,
--          trials, and verdicts are tier-agnostic. Default 'agent' so
--          every historical row and any pre-tier writer stays honest —
--          nothing silently gets cheaper.
-- Plan: docs/plans/2026-07-02-001-feat-eval-execution-tiers-plan.md
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0200_eval_results_execution_tier.sql
--
-- Hand-rolled (NOT registered in meta/_journal.json — repo convention is
-- psql-applied files gated by the db:migrate-manual drift reporter).
--
-- creates-column: public.eval_results.execution_tier
-- creates-constraint: public.eval_results.eval_results_execution_tier_check

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.eval_results
  ADD COLUMN IF NOT EXISTS execution_tier text NOT NULL DEFAULT 'agent';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'eval_results_execution_tier_check'
      AND conrelid = 'public.eval_results'::regclass
  ) THEN
    ALTER TABLE public.eval_results
      ADD CONSTRAINT eval_results_execution_tier_check
      CHECK (execution_tier IN ('agent', 'model'));
  END IF;
END $$;

COMMIT;
