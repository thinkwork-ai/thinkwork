-- creates: public.harness_tool_execution_events
-- creates: public.idx_harness_tool_execution_turn
-- creates: public.uq_harness_tool_execution_started
-- creates: public.uq_harness_tool_execution_terminal
-- creates-function: public.reject_harness_tool_execution_event_mutation
-- creates-function: public.validate_harness_tool_execution_event_insert
-- creates-trigger: public.harness_tool_execution_events.trg_reject_harness_tool_execution_event_mutation
-- creates-trigger: public.harness_tool_execution_events.trg_validate_harness_tool_execution_event_insert
-- Target-side Harness tool evidence. This is a sanitized append-only event
-- stream, separate from the governed-effect claim/result cache in migration
-- 0261. Targets write before credential resolution and once at terminal state.

CREATE TABLE IF NOT EXISTS public.harness_tool_execution_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
  turn_id uuid NOT NULL REFERENCES public.thread_turns(id) ON DELETE CASCADE,
  principal_type text NOT NULL CHECK (principal_type IN ('user', 'service')),
  principal_id text NOT NULL,
  tool_use_id text NOT NULL,
  operation text NOT NULL,
  policy_revision text NOT NULL,
  policy_decision_id text,
  idempotency_key text NOT NULL,
  credential_owner_alias text,
  event_type text NOT NULL
    CHECK (event_type IN ('started','completed','failed','uncertain')),
  input_preview jsonb,
  output_preview jsonb,
  error_preview jsonb,
  provider_request_id text,
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  provider_cost_usd numeric(18,8)
    CHECK (provider_cost_usd IS NULL OR provider_cost_usd >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (
      event_type = 'started'
      AND input_preview IS NOT NULL
      AND output_preview IS NULL
      AND error_preview IS NULL
      AND provider_request_id IS NULL
      AND duration_ms IS NULL
      AND provider_cost_usd IS NULL
    )
    OR (
      event_type IN ('completed','failed','uncertain')
      AND input_preview IS NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_harness_tool_execution_started
  ON public.harness_tool_execution_events (tenant_id, idempotency_key)
  WHERE event_type = 'started';

CREATE UNIQUE INDEX IF NOT EXISTS uq_harness_tool_execution_terminal
  ON public.harness_tool_execution_events (tenant_id, idempotency_key)
  WHERE event_type IN ('completed','failed','uncertain');

CREATE INDEX IF NOT EXISTS idx_harness_tool_execution_turn
  ON public.harness_tool_execution_events (tenant_id, thread_id, turn_id, id);

CREATE OR REPLACE FUNCTION public.validate_harness_tool_execution_event_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.event_type = 'started' THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.harness_tool_execution_events started
    WHERE started.tenant_id = NEW.tenant_id
      AND started.idempotency_key = NEW.idempotency_key
      AND started.event_type = 'started'
      AND started.thread_id = NEW.thread_id
      AND started.turn_id = NEW.turn_id
      AND started.principal_type = NEW.principal_type
      AND started.principal_id = NEW.principal_id
      AND started.tool_use_id = NEW.tool_use_id
      AND started.operation = NEW.operation
      AND started.policy_revision = NEW.policy_revision
  ) THEN
    RAISE EXCEPTION 'harness_tool_execution_terminal_without_matching_start';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_harness_tool_execution_event_insert
  ON public.harness_tool_execution_events;
CREATE TRIGGER trg_validate_harness_tool_execution_event_insert
BEFORE INSERT ON public.harness_tool_execution_events
FOR EACH ROW EXECUTE FUNCTION public.validate_harness_tool_execution_event_insert();

CREATE OR REPLACE FUNCTION public.reject_harness_tool_execution_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'harness_tool_execution_events_are_append_only';
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_harness_tool_execution_event_mutation
  ON public.harness_tool_execution_events;
CREATE TRIGGER trg_reject_harness_tool_execution_event_mutation
BEFORE UPDATE OR DELETE ON public.harness_tool_execution_events
FOR EACH ROW EXECUTE FUNCTION public.reject_harness_tool_execution_event_mutation();
