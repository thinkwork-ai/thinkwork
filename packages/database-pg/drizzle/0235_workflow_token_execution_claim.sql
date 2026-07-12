-- THINK-193 U1 (Codex F1/F7/F9): durable pre-execution claim for workflow
-- task tokens. Adds the 'executing' status (pending -> executing -> consumed),
-- lease columns (locked_at/locked_by, stale claims are re-claimable), and a
-- persisted completion result for safe redrive after a SendTaskSuccess
-- transient failure.
--
-- Hand-rolled (drizzle meta journal is not in use for this change);
-- apply with: psql "$DATABASE_URL" -f drizzle/0235_workflow_token_execution_claim.sql
-- creates-constraint: public.workflow_task_tokens.workflow_task_tokens_status_check_v2
-- creates-column: public.workflow_task_tokens.locked_at
-- creates-column: public.workflow_task_tokens.locked_by
-- creates-column: public.workflow_task_tokens.result
--
-- The constraint is RENAMED (_v2), not redefined in place: the drift
-- reporter probes constraints by NAME only, so redefining under the old
-- name would report APPLIED on environments still carrying the narrow
-- three-status list. The _v2 name makes an unapplied widening visible as
-- MISSING. (Same precedent as 0233's purpose-check widening.)

ALTER TABLE public.workflow_task_tokens
  ADD COLUMN IF NOT EXISTS locked_at timestamptz;
ALTER TABLE public.workflow_task_tokens
  ADD COLUMN IF NOT EXISTS locked_by text;
ALTER TABLE public.workflow_task_tokens
  ADD COLUMN IF NOT EXISTS result jsonb;

ALTER TABLE public.workflow_task_tokens
  DROP CONSTRAINT IF EXISTS workflow_task_tokens_status_check;
ALTER TABLE public.workflow_task_tokens
  DROP CONSTRAINT IF EXISTS workflow_task_tokens_status_check_v2;
ALTER TABLE public.workflow_task_tokens
  ADD CONSTRAINT workflow_task_tokens_status_check_v2 CHECK (
    status IN ('pending', 'executing', 'consumed', 'expired')
  );
