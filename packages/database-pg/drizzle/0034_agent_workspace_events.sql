-- creates: public.agent_workspace_runs
-- creates: public.agent_workspace_events
-- creates: public.agent_workspace_waits
-- creates-column: public.tenants.workspace_orchestration_enabled

ALTER TABLE public.tenants
ADD COLUMN IF NOT EXISTS workspace_orchestration_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.agent_workspace_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  agent_id uuid NOT NULL REFERENCES public.agents(id),
  target_path text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  source_object_key text,
  request_object_key text,
  current_wakeup_request_id uuid REFERENCES public.agent_wakeup_requests(id),
  current_thread_turn_id uuid REFERENCES public.thread_turns(id),
  parent_run_id uuid REFERENCES public.agent_workspace_runs(id),
  depth integer NOT NULL DEFAULT 0,
  inbox_write_count integer NOT NULL DEFAULT 0,
  wakeup_retry_count integer NOT NULL DEFAULT 0,
  last_event_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_workspace_runs_status_check CHECK (
    status IN (
      'pending',
      'claimed',
      'processing',
      'completed',
      'failed',
      'awaiting_review',
      'awaiting_subrun',
      'cancelled',
      'expired'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_agent_workspace_runs_agent_target_status
  ON public.agent_workspace_runs (tenant_id, agent_id, target_path, status);
CREATE INDEX IF NOT EXISTS idx_agent_workspace_runs_status_last_event
  ON public.agent_workspace_runs (status, last_event_at);
CREATE INDEX IF NOT EXISTS idx_agent_workspace_runs_parent
  ON public.agent_workspace_runs (parent_run_id);

CREATE TABLE IF NOT EXISTS public.agent_workspace_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  agent_id uuid REFERENCES public.agents(id),
  run_id uuid REFERENCES public.agent_workspace_runs(id),
  event_type text NOT NULL,
  idempotency_key text NOT NULL,
  bucket text NOT NULL,
  source_object_key text NOT NULL,
  audit_object_key text,
  object_etag text,
  object_version_id text,
  sequencer text NOT NULL,
  mirror_status text NOT NULL DEFAULT 'ok',
  reason text,
  payload jsonb,
  actor_type text,
  actor_id text,
  parent_event_id bigint REFERENCES public.agent_workspace_events(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_workspace_events_type_check CHECK (
    event_type IN (
      'work.requested',
      'run.started',
      'run.blocked',
      'run.completed',
      'run.failed',
      'review.requested',
      'memory.changed',
      'event.rejected'
    )
  ),
  CONSTRAINT agent_workspace_events_mirror_status_check CHECK (
    mirror_status IN ('ok', 'failed')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_workspace_events_tenant_idempotency
  ON public.agent_workspace_events (tenant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_agent_workspace_events_run_created
  ON public.agent_workspace_events (run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_workspace_events_pending
  ON public.agent_workspace_events (tenant_id, event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_workspace_events_parent
  ON public.agent_workspace_events (parent_event_id);

CREATE TABLE IF NOT EXISTS public.agent_workspace_waits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  waiting_run_id uuid NOT NULL REFERENCES public.agent_workspace_runs(id),
  wait_for_run_id uuid REFERENCES public.agent_workspace_runs(id),
  wait_for_target_path text,
  status text NOT NULL DEFAULT 'waiting',
  created_at timestamptz NOT NULL DEFAULT now(),
  satisfied_at timestamptz,
  CONSTRAINT agent_workspace_waits_status_check CHECK (
    status IN ('waiting', 'satisfied', 'cancelled', 'expired')
  ),
  CONSTRAINT agent_workspace_waits_single_wait_shape CHECK (
    wait_for_run_id IS NOT NULL OR wait_for_target_path IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_agent_workspace_waits_waiting
  ON public.agent_workspace_waits (tenant_id, waiting_run_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_workspace_waits_wait_for
  ON public.agent_workspace_waits (tenant_id, wait_for_run_id, status);

