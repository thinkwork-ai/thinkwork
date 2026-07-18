-- creates: public.harness_managed_thread_enrollments
-- creates: public.thread_public_events
-- creates: public.harness_participant_sessions
-- creates: public.harness_participant_session_events
-- creates: public.harness_governed_tool_executions
-- creates: public.harness_disclosure_decisions
-- creates-function: public.capture_harness_message_public_event
-- creates-function: public.capture_harness_artifact_public_event
-- creates-trigger: public.messages.trg_capture_harness_message_public_event
-- creates-trigger: public.message_artifacts.trg_capture_harness_artifact_public_event
-- Managed multiplayer Harness proof ledger. Hand-rolled because this migration
-- also installs admission triggers over existing canonical message tables.

CREATE TABLE IF NOT EXISTS public.harness_managed_thread_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
  logical_agent_id uuid NOT NULL REFERENCES public.agents(id),
  trust_profile text NOT NULL,
  harness_arn text NOT NULL,
  qualifier text NOT NULL,
  resolved_version text NOT NULL,
  session_strategy text NOT NULL DEFAULT 'fresh'
    CHECK (session_strategy = 'fresh'),
  prior_runtime text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'restoring', 'restored', 'failed')),
  enrolled_by_user_id uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  restored_at timestamptz,
  UNIQUE (tenant_id, thread_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_harness_enrollment_active_profile
  ON public.harness_managed_thread_enrollments (tenant_id, trust_profile)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.thread_public_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
  source_kind text NOT NULL CHECK (source_kind IN ('message', 'message_artifact')),
  source_id uuid NOT NULL,
  source_version text NOT NULL,
  event_kind text NOT NULL CHECK (event_kind IN ('insert', 'invalidate')),
  canonical_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, thread_id, source_kind, source_id, source_version)
);

CREATE INDEX IF NOT EXISTS idx_thread_public_events_prefix
  ON public.thread_public_events (tenant_id, thread_id, id);

CREATE TABLE IF NOT EXISTS public.harness_participant_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES public.harness_managed_thread_enrollments(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
  participant_user_id uuid NOT NULL REFERENCES public.users(id),
  turn_id uuid NOT NULL REFERENCES public.thread_turns(id) ON DELETE CASCADE,
  runtime_session_id text NOT NULL UNIQUE,
  generation integer NOT NULL DEFAULT 1 CHECK (generation = 1),
  captured_high_water bigint NOT NULL,
  applied_high_water bigint,
  qualifier text NOT NULL,
  resolved_version text NOT NULL,
  base_fingerprint text NOT NULL,
  participant_fingerprint text NOT NULL,
  state text NOT NULL DEFAULT 'allocated'
    CHECK (state IN ('allocated', 'running', 'finalizing', 'completed', 'abandoned')),
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (tenant_id, turn_id),
  CHECK (
    (state IN ('completed', 'abandoned') AND finished_at IS NOT NULL)
    OR (state NOT IN ('completed', 'abandoned') AND finished_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_harness_participant_sessions_thread
  ON public.harness_participant_sessions
  (tenant_id, thread_id, participant_user_id, created_at);

CREATE TABLE IF NOT EXISTS public.harness_participant_session_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.harness_participant_sessions(id) ON DELETE CASCADE,
  turn_id uuid NOT NULL REFERENCES public.thread_turns(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  from_state text,
  to_state text NOT NULL
    CHECK (to_state IN ('allocated', 'running', 'finalizing', 'completed', 'abandoned')),
  reason_code text,
  applied_high_water bigint,
  evidence jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_harness_session_events_session
  ON public.harness_participant_session_events (session_id, id);

CREATE TABLE IF NOT EXISTS public.harness_governed_tool_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  turn_id uuid NOT NULL REFERENCES public.thread_turns(id) ON DELETE CASCADE,
  participant_user_id uuid NOT NULL REFERENCES public.users(id),
  session_id uuid NOT NULL REFERENCES public.harness_participant_sessions(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  audience text NOT NULL,
  operation text NOT NULL,
  tool_use_id text NOT NULL,
  input_digest text NOT NULL,
  state text NOT NULL DEFAULT 'claimed'
    CHECK (state IN ('claimed', 'completed', 'failed', 'ambiguous')),
  policy_decision_id text,
  credential_owner_alias text,
  sanitized_result jsonb,
  failure_reason text,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_harness_governed_tool_turn
  ON public.harness_governed_tool_executions (turn_id);

CREATE TABLE IF NOT EXISTS public.harness_disclosure_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  participant_user_id uuid NOT NULL REFERENCES public.users(id),
  thread_id uuid NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
  turn_id uuid NOT NULL REFERENCES public.thread_turns(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.harness_participant_sessions(id) ON DELETE CASCADE,
  operation text NOT NULL,
  projection_digest text NOT NULL,
  status text NOT NULL
    CHECK (status IN ('published', 'withheld', 'confirmation_required')),
  reason_code text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_harness_disclosure_turn
  ON public.harness_disclosure_decisions (turn_id);

CREATE OR REPLACE FUNCTION public.capture_harness_message_public_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  digest_value text;
  version_value text;
  event_value text;
  admitted_before boolean;
  admitted_now boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.thread_public_events e
      WHERE e.tenant_id = OLD.tenant_id
        AND e.thread_id = OLD.thread_id
        AND e.source_kind = 'message'
        AND e.source_id = OLD.id
    ) THEN
      RETURN OLD;
    END IF;
    digest_value := encode(digest(concat_ws('|', OLD.role, coalesce(OLD.content, ''), coalesce(OLD.parts::text, ''), coalesce(OLD.metadata::text, '')), 'sha256'), 'hex');
    version_value := 'delete:' || digest_value;
    event_value := 'invalidate';
    INSERT INTO public.thread_public_events (
      tenant_id, thread_id, source_kind, source_id, source_version,
      event_kind, canonical_digest
    ) VALUES (
      OLD.tenant_id, OLD.thread_id, 'message', OLD.id,
      version_value, event_value, digest_value
    ) ON CONFLICT DO NOTHING;
    RETURN OLD;
  END IF;

  admitted_now := NEW.role IN ('user', 'assistant')
    AND coalesce(NEW.metadata->>'visibility', 'public') = 'public'
    AND coalesce(NEW.metadata->>'disclosure_status', 'published') NOT IN ('withheld', 'confirmation_required')
    AND EXISTS (
      SELECT 1 FROM public.harness_managed_thread_enrollments e
      WHERE e.tenant_id = NEW.tenant_id
        AND e.thread_id = NEW.thread_id
        AND e.status = 'active'
    );

  IF TG_OP = 'UPDATE' THEN
    admitted_before := EXISTS (
      SELECT 1 FROM public.thread_public_events e
      WHERE e.tenant_id = OLD.tenant_id
        AND e.thread_id = OLD.thread_id
        AND e.source_kind = 'message'
        AND e.source_id = OLD.id
    );
    IF admitted_before THEN
      digest_value := encode(digest(concat_ws('|', OLD.role, coalesce(OLD.content, ''), coalesce(OLD.parts::text, ''), coalesce(OLD.metadata::text, '')), 'sha256'), 'hex');
      version_value := 'invalidate:update:' || encode(digest(concat_ws('|', NEW.role, coalesce(NEW.content, ''), coalesce(NEW.parts::text, ''), coalesce(NEW.metadata::text, '')), 'sha256'), 'hex');
      INSERT INTO public.thread_public_events (
        tenant_id, thread_id, source_kind, source_id, source_version,
        event_kind, canonical_digest
      ) VALUES (
        OLD.tenant_id, OLD.thread_id, 'message', OLD.id,
        version_value, 'invalidate', digest_value
      ) ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  IF NOT admitted_now THEN
    RETURN NEW;
  END IF;

  digest_value := encode(digest(concat_ws('|', NEW.role, coalesce(NEW.content, ''), coalesce(NEW.parts::text, '')), 'sha256'), 'hex');
  version_value := lower(TG_OP) || ':' || digest_value || ':' || encode(digest(coalesce(NEW.metadata::text, ''), 'sha256'), 'hex');
  INSERT INTO public.thread_public_events (
    tenant_id, thread_id, source_kind, source_id, source_version,
    event_kind, canonical_digest
  ) VALUES (
    NEW.tenant_id, NEW.thread_id, 'message', NEW.id,
    version_value, 'insert', digest_value
  ) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_capture_harness_message_public_event ON public.messages;
CREATE TRIGGER trg_capture_harness_message_public_event
AFTER INSERT OR UPDATE OR DELETE ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.capture_harness_message_public_event();

CREATE OR REPLACE FUNCTION public.capture_harness_artifact_public_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  digest_value text;
  version_value text;
  admitted_before boolean;
  admitted_now boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.thread_public_events e
      WHERE e.tenant_id = OLD.tenant_id
        AND e.thread_id = OLD.thread_id
        AND e.source_kind = 'message_artifact'
        AND e.source_id = OLD.id
    ) THEN
      RETURN OLD;
    END IF;
    digest_value := encode(digest(concat_ws('|', OLD.artifact_type, coalesce(OLD.name, ''), coalesce(OLD.artifact_id::text, ''), coalesce(OLD.metadata::text, '')), 'sha256'), 'hex');
    INSERT INTO public.thread_public_events (
      tenant_id, thread_id, source_kind, source_id, source_version,
      event_kind, canonical_digest
    ) VALUES (
      OLD.tenant_id, OLD.thread_id, 'message_artifact', OLD.id,
      'delete:' || digest_value, 'invalidate', digest_value
    ) ON CONFLICT DO NOTHING;
    RETURN OLD;
  END IF;

  admitted_now := EXISTS (
    SELECT 1 FROM public.harness_managed_thread_enrollments e
    WHERE e.tenant_id = NEW.tenant_id
      AND e.thread_id = NEW.thread_id
      AND e.status = 'active'
  ) AND coalesce(NEW.metadata->>'access_state', 'public') = 'public';

  IF TG_OP = 'UPDATE' THEN
    admitted_before := EXISTS (
      SELECT 1 FROM public.thread_public_events e
      WHERE e.tenant_id = OLD.tenant_id
        AND e.thread_id = OLD.thread_id
        AND e.source_kind = 'message_artifact'
        AND e.source_id = OLD.id
    );
    IF admitted_before THEN
      digest_value := encode(digest(concat_ws('|', OLD.artifact_type, coalesce(OLD.name, ''), coalesce(OLD.artifact_id::text, ''), coalesce(OLD.metadata::text, '')), 'sha256'), 'hex');
      version_value := 'invalidate:update:' || encode(digest(concat_ws('|', NEW.artifact_type, coalesce(NEW.name, ''), coalesce(NEW.artifact_id::text, ''), coalesce(NEW.metadata::text, '')), 'sha256'), 'hex');
      INSERT INTO public.thread_public_events (
        tenant_id, thread_id, source_kind, source_id, source_version,
        event_kind, canonical_digest
      ) VALUES (
        OLD.tenant_id, OLD.thread_id, 'message_artifact', OLD.id,
        version_value, 'invalidate', digest_value
      ) ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  IF NOT admitted_now THEN
    RETURN NEW;
  END IF;

  digest_value := encode(digest(concat_ws('|', NEW.artifact_type, coalesce(NEW.name, ''), coalesce(NEW.artifact_id::text, ''), coalesce(NEW.metadata::text, '')), 'sha256'), 'hex');
  INSERT INTO public.thread_public_events (
    tenant_id, thread_id, source_kind, source_id, source_version,
    event_kind, canonical_digest
  ) VALUES (
    NEW.tenant_id, NEW.thread_id, 'message_artifact', NEW.id,
    lower(TG_OP) || ':' || digest_value, 'insert', digest_value
  ) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_capture_harness_artifact_public_event ON public.message_artifacts;
CREATE TRIGGER trg_capture_harness_artifact_public_event
AFTER INSERT OR UPDATE OR DELETE ON public.message_artifacts
FOR EACH ROW EXECUTE FUNCTION public.capture_harness_artifact_public_event();
