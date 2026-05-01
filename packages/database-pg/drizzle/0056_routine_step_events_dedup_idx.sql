-- Hand-rolled migration: routine_step_events dedup unique index
-- Plan: docs/plans/2026-05-01-005-feat-routines-phase-b-runtime-plan.md §U9
--
-- The routine-step-callback handler ingests events fired from two paths
-- that can both double-deliver:
--   * Task-wrapper Lambdas (routine-task-python, routine-resume) on
--     SFN Lambda-retry
--   * EventBridge → routine-step-callback for SFN execution-state-change
--     events on the agent_invoke recipe (no wrapper Lambda)
--
-- Idempotency relies on ON CONFLICT DO NOTHING against this unique index.
-- The 4-tuple (execution_id, node_id, status, started_at) matches the
-- schema's idempotency contract documented in
-- packages/database-pg/src/schema/routine-step-events.ts.
--
-- Partial-index `WHERE started_at IS NOT NULL` because Postgres treats
-- NULLs as distinct in unique indexes by default; events without a
-- started_at fall back to non-deduped insert (rare and harmless — UI
-- shows them as separate rows, not duplicates).
--
-- creates: public.idx_routine_step_events_dedup

CREATE UNIQUE INDEX IF NOT EXISTS idx_routine_step_events_dedup
  ON public.routine_step_events (execution_id, node_id, status, started_at)
  WHERE started_at IS NOT NULL;
