-- Durable memory retain attempt ledger for Hindsight retain retries.
-- Plan: docs/plans/2026-06-28-001-fix-memory-retain-recall-reliability-plan.md (U1).
--
-- creates: public.memory_retain_attempts
-- creates: public.memory_retain_attempts_source_event_uidx
-- creates: public.memory_retain_attempts_due_idx
-- creates: public.memory_retain_attempts_tenant_status_idx
-- creates: public.memory_retain_attempts_thread_idx
-- creates: public.memory_retain_attempts_user_idx
-- creates: public.memory_retain_attempts_space_idx
-- creates: public.memory_retain_attempts_turn_idx
-- creates-constraint: public.memory_retain_attempts.memory_retain_attempts_tenant_id_tenants_id_fk
-- creates-constraint: public.memory_retain_attempts.memory_retain_attempts_user_id_users_id_fk
-- creates-constraint: public.memory_retain_attempts.memory_retain_attempts_space_id_spaces_id_fk
-- creates-constraint: public.memory_retain_attempts.memory_retain_attempts_thread_id_threads_id_fk
-- creates-constraint: public.memory_retain_attempts.memory_retain_attempts_thread_turn_id_thread_turns_id_fk
-- creates-constraint: public.memory_retain_attempts.memory_retain_attempts_status_allowed
-- creates-constraint: public.memory_retain_attempts.memory_retain_attempts_attempt_count_nonnegative
-- creates-constraint: public.memory_retain_attempts.memory_retain_attempts_max_attempts_positive

DO $$
BEGIN
  IF to_regclass('public.tenants') IS NULL THEN
    RAISE EXCEPTION 'tenants not found; apply core tenant migrations first';
  END IF;
  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'users not found; apply core user migrations first';
  END IF;
  IF to_regclass('public.spaces') IS NULL THEN
    RAISE EXCEPTION 'spaces not found; apply Space migrations first';
  END IF;
  IF to_regclass('public.threads') IS NULL THEN
    RAISE EXCEPTION 'threads not found; apply thread migrations first';
  END IF;
  IF to_regclass('public.thread_turns') IS NULL THEN
    RAISE EXCEPTION 'thread_turns not found; apply scheduled job execution migrations first';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.memory_retain_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL
    CONSTRAINT memory_retain_attempts_tenant_id_tenants_id_fk
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid
    CONSTRAINT memory_retain_attempts_user_id_users_id_fk
    REFERENCES public.users(id) ON DELETE SET NULL,
  space_id uuid
    CONSTRAINT memory_retain_attempts_space_id_spaces_id_fk
    REFERENCES public.spaces(id) ON DELETE SET NULL,
  thread_id uuid NOT NULL
    CONSTRAINT memory_retain_attempts_thread_id_threads_id_fk
    REFERENCES public.threads(id) ON DELETE CASCADE,
  thread_turn_id uuid
    CONSTRAINT memory_retain_attempts_thread_turn_id_thread_turns_id_fk
    REFERENCES public.thread_turns(id) ON DELETE SET NULL,
  source_event_key text NOT NULL,
  source_event_type text NOT NULL DEFAULT 'thread_turn',
  provider text NOT NULL DEFAULT 'hindsight',
  status text NOT NULL DEFAULT 'queued',
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_retry_at timestamp with time zone,
  locked_at timestamp with time zone,
  locked_by text,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  backend_latency_ms integer,
  provider_document_id text,
  provider_result jsonb,
  error_class text,
  error_message text,
  metadata jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT memory_retain_attempts_status_allowed
    CHECK (status IN ('queued','running','retained','failed_timeout','failed_backend','dead_lettered')),
  CONSTRAINT memory_retain_attempts_attempt_count_nonnegative
    CHECK (attempt_count >= 0),
  CONSTRAINT memory_retain_attempts_max_attempts_positive
    CHECK (max_attempts > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS memory_retain_attempts_source_event_uidx
  ON public.memory_retain_attempts (tenant_id, thread_id, source_event_key);

CREATE INDEX IF NOT EXISTS memory_retain_attempts_due_idx
  ON public.memory_retain_attempts (status, next_retry_at, created_at);

CREATE INDEX IF NOT EXISTS memory_retain_attempts_tenant_status_idx
  ON public.memory_retain_attempts (tenant_id, status, created_at);

CREATE INDEX IF NOT EXISTS memory_retain_attempts_thread_idx
  ON public.memory_retain_attempts (tenant_id, thread_id, created_at);

CREATE INDEX IF NOT EXISTS memory_retain_attempts_user_idx
  ON public.memory_retain_attempts (tenant_id, user_id, created_at);

CREATE INDEX IF NOT EXISTS memory_retain_attempts_space_idx
  ON public.memory_retain_attempts (tenant_id, space_id, created_at);

CREATE INDEX IF NOT EXISTS memory_retain_attempts_turn_idx
  ON public.memory_retain_attempts (thread_turn_id);
