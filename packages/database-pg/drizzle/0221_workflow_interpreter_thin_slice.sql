-- THINK-219 U2: workflow interpreter thin slice — additive schema room.
-- Contents:
--   * workflow_runs_status_check widened with 'waiting_for_human' (approval
--     suspension state for task-token waits).
--   * workflow_engine_bindings_type_check widened with
--     'step_functions_interpreter' (the shared interpreter machine binding).
--   * scheduled_jobs.workflow_id — nullable FK binding a schedule trigger to
--     a workflow (workflow_schedule trigger type; trigger_type itself is
--     unconstrained text, no CHECK exists for it).
--   * workflow_task_tokens — Step Functions task-token store keyed by
--     (run, step, iteration, purpose); tokens never travel in payloads.
--
-- NOT done here (deliberately): no agent_loops changes, no destructive
-- drops, no event_type constraints (workflow_run_events.event_type stays
-- convention-enforced text).
--
-- Hand-rolled (drizzle meta journal is not in use for this change);
-- apply with: psql "$DATABASE_URL" -f drizzle/0221_workflow_interpreter_thin_slice.sql
-- creates: public.workflow_task_tokens
-- creates-column: public.scheduled_jobs.workflow_id
-- creates-constraint: public.workflow_runs.workflow_runs_status_check
-- creates-constraint: public.workflow_engine_bindings.workflow_engine_bindings_type_check

ALTER TABLE public.workflow_runs
  DROP CONSTRAINT IF EXISTS workflow_runs_status_check;
ALTER TABLE public.workflow_runs
  ADD CONSTRAINT workflow_runs_status_check CHECK (
    status IN (
      'queued', 'running', 'waiting_for_human', 'succeeded', 'failed',
      'canceled', 'timed_out', 'blocked_not_ready'
    )
  );

ALTER TABLE public.workflow_engine_bindings
  DROP CONSTRAINT IF EXISTS workflow_engine_bindings_type_check;
ALTER TABLE public.workflow_engine_bindings
  ADD CONSTRAINT workflow_engine_bindings_type_check CHECK (
    binding_type IN (
      'step_functions_routine', 'step_functions_interpreter', 'n8n_bridge',
      'n8n_import', 'twenty_crm', 'connected_app', 'native'
    )
  );

ALTER TABLE public.scheduled_jobs
  ADD COLUMN IF NOT EXISTS workflow_id uuid REFERENCES public.workflows(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_workflow
  ON public.scheduled_jobs (workflow_id);

CREATE TABLE IF NOT EXISTS public.workflow_task_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  workflow_run_id uuid NOT NULL REFERENCES public.workflow_runs(id) ON DELETE CASCADE,
  step_id text NOT NULL,
  iteration integer NOT NULL DEFAULT 1,
  purpose text NOT NULL,
  token text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_task_tokens_purpose_check
    CHECK (purpose IN ('agent_step', 'approval')),
  CONSTRAINT workflow_task_tokens_status_check
    CHECK (status IN ('pending', 'consumed', 'expired'))
);

CREATE UNIQUE INDEX IF NOT EXISTS workflow_task_tokens_step_uidx
  ON public.workflow_task_tokens (workflow_run_id, step_id, iteration, purpose);

CREATE INDEX IF NOT EXISTS workflow_task_tokens_tenant_idx
  ON public.workflow_task_tokens (tenant_id);
