-- THINK-193 U1: widen workflow_task_tokens purpose domain with
-- 'memory_stage' (task tokens held while a memory pipeline stage runs).
--
-- Hand-rolled (drizzle meta journal is not in use for this change);
-- apply with: psql "$DATABASE_URL" -f drizzle/0233_workflow_memory_stage_tokens.sql
-- creates-constraint: public.workflow_task_tokens.workflow_task_tokens_purpose_check

ALTER TABLE public.workflow_task_tokens
  DROP CONSTRAINT IF EXISTS workflow_task_tokens_purpose_check;
ALTER TABLE public.workflow_task_tokens
  ADD CONSTRAINT workflow_task_tokens_purpose_check CHECK (
    purpose IN ('agent_step', 'approval', 'memory_stage')
  );
