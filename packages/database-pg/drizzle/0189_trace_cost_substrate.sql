-- Trusted trace and cost accounting substrate.
-- Plan: docs/plans/2026-06-25-003-feat-trace-cost-substrate-plan.md (U1).
--
-- creates: public.trace_runs
-- creates: public.trace_events
-- creates: public.trace_source_evidence
-- creates: public.trace_cost_reconciliation_facts
-- creates: public.trace_runs_tenant_trace_uidx
-- creates: public.trace_runs_thread_turn_idx
-- creates: public.trace_runs_thread_idx
-- creates: public.trace_runs_agent_created_idx
-- creates: public.trace_events_run_observed_idx
-- creates: public.trace_events_parent_idx
-- creates: public.trace_events_request_idx
-- creates: public.trace_events_turn_type_idx
-- creates: public.trace_source_evidence_run_idx
-- creates: public.trace_source_evidence_event_idx
-- creates: public.trace_source_evidence_source_idx
-- creates: public.trace_cost_recon_facts_cost_event_idx
-- creates: public.trace_cost_recon_facts_trace_event_idx
-- creates: public.trace_cost_recon_facts_state_idx
-- creates: public.trace_cost_recon_facts_request_idx
-- creates-column: public.cost_events.trace_event_id
-- creates-column: public.cost_events.reconciliation_state
-- creates-column: public.cost_events.reconciliation_source
-- creates-column: public.cost_events.reconciliation_at
-- creates-column: public.cost_events.source_evidence_ref

DO $$
BEGIN
  IF to_regclass('public.tenants') IS NULL THEN
    RAISE EXCEPTION 'tenants not found; apply core tenant migrations first';
  END IF;
  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'users not found; apply core user migrations first';
  END IF;
  IF to_regclass('public.agents') IS NULL THEN
    RAISE EXCEPTION 'agents not found; apply agent migrations first';
  END IF;
  IF to_regclass('public.thread_turns') IS NULL THEN
    RAISE EXCEPTION 'thread_turns not found; apply scheduled job execution migrations first';
  END IF;
  IF to_regclass('public.cost_events') IS NULL THEN
    RAISE EXCEPTION 'cost_events not found; apply cost event migrations first';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.trace_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  trace_id text NOT NULL,
  thread_id uuid,
  thread_turn_id uuid REFERENCES public.thread_turns(id) ON DELETE SET NULL,
  agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  runtime_type text,
  runtime_session_id text,
  status text NOT NULL DEFAULT 'open',
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS trace_runs_tenant_trace_uidx
  ON public.trace_runs (tenant_id, trace_id);
CREATE INDEX IF NOT EXISTS trace_runs_thread_turn_idx
  ON public.trace_runs (thread_turn_id);
CREATE INDEX IF NOT EXISTS trace_runs_thread_idx
  ON public.trace_runs (tenant_id, thread_id);
CREATE INDEX IF NOT EXISTS trace_runs_agent_created_idx
  ON public.trace_runs (agent_id, created_at);

CREATE TABLE IF NOT EXISTS public.trace_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  trace_run_id uuid NOT NULL REFERENCES public.trace_runs(id) ON DELETE CASCADE,
  parent_event_id uuid REFERENCES public.trace_events(id) ON DELETE SET NULL,
  thread_turn_id uuid REFERENCES public.thread_turns(id) ON DELETE SET NULL,
  request_id text,
  parent_request_id text,
  event_type text NOT NULL,
  event_status text,
  observed_at timestamp with time zone NOT NULL DEFAULT now(),
  duration_ms integer,
  payload_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_evidence_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT trace_events_type_check CHECK (
    event_type IN (
      'turn',
      'runtime_phase',
      'model_invocation',
      'tool_invocation',
      'memory_context_lookup',
      'workspace_hydration',
      'response_finalization',
      'agent_profile_run',
      'sub_agent_lane',
      'cost_observation'
    )
  )
);

CREATE INDEX IF NOT EXISTS trace_events_run_observed_idx
  ON public.trace_events (trace_run_id, observed_at);
CREATE INDEX IF NOT EXISTS trace_events_parent_idx
  ON public.trace_events (parent_event_id);
CREATE INDEX IF NOT EXISTS trace_events_request_idx
  ON public.trace_events (tenant_id, request_id);
CREATE INDEX IF NOT EXISTS trace_events_turn_type_idx
  ON public.trace_events (thread_turn_id, event_type);

CREATE TABLE IF NOT EXISTS public.trace_source_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  trace_run_id uuid REFERENCES public.trace_runs(id) ON DELETE CASCADE,
  trace_event_id uuid REFERENCES public.trace_events(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_system text NOT NULL,
  source_id text,
  uri text,
  observed_at timestamp with time zone,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  redaction_state text NOT NULL DEFAULT 'summary_only',
  retention_expires_at timestamp with time zone,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT trace_source_evidence_source_type_check CHECK (
    source_type IN (
      'runtime',
      'agentcore_span',
      'bedrock_invocation_log',
      'aws_cur',
      'operator',
      'backfill'
    )
  )
);

CREATE INDEX IF NOT EXISTS trace_source_evidence_run_idx
  ON public.trace_source_evidence (trace_run_id);
CREATE INDEX IF NOT EXISTS trace_source_evidence_event_idx
  ON public.trace_source_evidence (trace_event_id);
CREATE INDEX IF NOT EXISTS trace_source_evidence_source_idx
  ON public.trace_source_evidence (tenant_id, source_type, source_id);

CREATE TABLE IF NOT EXISTS public.trace_cost_reconciliation_facts (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  trace_run_id uuid REFERENCES public.trace_runs(id) ON DELETE CASCADE,
  trace_event_id uuid REFERENCES public.trace_events(id) ON DELETE SET NULL,
  cost_event_id uuid REFERENCES public.cost_events(id) ON DELETE SET NULL,
  source_evidence_id uuid REFERENCES public.trace_source_evidence(id) ON DELETE SET NULL,
  reconciliation_state text NOT NULL,
  reconciliation_scope text NOT NULL,
  provider text,
  model text,
  request_id text,
  attribution_level text,
  runtime_input_tokens integer,
  runtime_output_tokens integer,
  runtime_cached_read_tokens integer,
  provider_input_tokens integer,
  provider_output_tokens integer,
  provider_cached_read_tokens integer,
  runtime_amount_usd numeric(12, 6),
  provider_amount_usd numeric(12, 6),
  billed_amount_usd numeric(12, 6),
  variance_usd numeric(12, 6),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  reconciled_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT trace_cost_recon_facts_state_check CHECK (
    reconciliation_state IN (
      'runtime-reported',
      'invocation-reconciled',
      'bill-reconciled',
      'mismatch',
      'unreconciled/error'
    )
  ),
  CONSTRAINT trace_cost_recon_facts_scope_check CHECK (
    reconciliation_scope IN (
      'runtime',
      'invocation',
      'bill',
      'aggregate',
      'operator_resolution'
    )
  )
);

CREATE INDEX IF NOT EXISTS trace_cost_recon_facts_cost_event_idx
  ON public.trace_cost_reconciliation_facts (cost_event_id);
CREATE INDEX IF NOT EXISTS trace_cost_recon_facts_trace_event_idx
  ON public.trace_cost_reconciliation_facts (trace_event_id);
CREATE INDEX IF NOT EXISTS trace_cost_recon_facts_state_idx
  ON public.trace_cost_reconciliation_facts (
    tenant_id,
    reconciliation_state,
    reconciled_at
  );
CREATE INDEX IF NOT EXISTS trace_cost_recon_facts_request_idx
  ON public.trace_cost_reconciliation_facts (tenant_id, provider, request_id);

ALTER TABLE public.cost_events
  ADD COLUMN IF NOT EXISTS trace_event_id uuid,
  ADD COLUMN IF NOT EXISTS reconciliation_state text NOT NULL DEFAULT 'runtime-reported',
  ADD COLUMN IF NOT EXISTS reconciliation_source text,
  ADD COLUMN IF NOT EXISTS reconciliation_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS source_evidence_ref jsonb;

CREATE INDEX IF NOT EXISTS idx_cost_events_trace_event
  ON public.cost_events (trace_event_id);
CREATE INDEX IF NOT EXISTS idx_cost_events_reconciliation_state
  ON public.cost_events (tenant_id, reconciliation_state, created_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cost_events_reconciliation_state_check'
  ) THEN
    ALTER TABLE public.cost_events
      ADD CONSTRAINT cost_events_reconciliation_state_check CHECK (
        reconciliation_state IN (
          'runtime-reported',
          'invocation-reconciled',
          'bill-reconciled',
          'mismatch',
          'unreconciled/error'
        )
      );
  END IF;
END $$;

COMMENT ON TABLE public.trace_runs IS
  'Canonical trace run identity for ThinkWork agent execution evidence.';
COMMENT ON TABLE public.trace_events IS
  'Append-only canonical trace event and observation records.';
COMMENT ON TABLE public.trace_source_evidence IS
  'Safe references and summaries for provider/runtime/billing source evidence.';
COMMENT ON TABLE public.trace_cost_reconciliation_facts IS
  'Append-only facts that reconcile runtime usage, provider invocation evidence, and billing exports.';
