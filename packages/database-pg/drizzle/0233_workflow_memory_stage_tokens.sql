-- THINK-193 U1: widen workflow_task_tokens purpose domain with
-- 'memory_stage' (task tokens held while a memory pipeline stage runs).
--
-- Hand-rolled (drizzle meta journal is not in use for this change);
-- apply with: psql "$DATABASE_URL" -f drizzle/0233_workflow_memory_stage_tokens.sql
-- creates-constraint: public.workflow_task_tokens.workflow_task_tokens_purpose_check_v2
--
-- The constraint is RENAMED (_v2), not redefined in place: the drift
-- reporter probes constraints by NAME only, so redefining under the old
-- name would report APPLIED on environments still carrying the narrow
-- 0221 list. The _v2 name makes an unapplied widening visible as MISSING.

ALTER TABLE public.workflow_task_tokens
  DROP CONSTRAINT IF EXISTS workflow_task_tokens_purpose_check;
ALTER TABLE public.workflow_task_tokens
  DROP CONSTRAINT IF EXISTS workflow_task_tokens_purpose_check_v2;
ALTER TABLE public.workflow_task_tokens
  ADD CONSTRAINT workflow_task_tokens_purpose_check_v2 CHECK (
    purpose IN ('agent_step', 'approval', 'memory_stage')
  );
