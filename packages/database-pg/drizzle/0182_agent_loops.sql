-- AgentLoop foundation schema.
-- Plan: docs/plans/2026-06-22-001-feat-agent-loop-foundation-plan.md (U1).
-- Apply manually (no CI migration runner):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0182_agent_loops.sql
--
-- Pre-flight:
--   SELECT to_regclass('public.tenants') AS tenants;
--   SELECT to_regclass('public.users') AS users;
--   SELECT to_regclass('public.agents') AS agents;
--   SELECT to_regclass('public.scheduled_jobs') AS scheduled_jobs;
--
-- creates: public.agent_loops
-- creates: public.agent_loop_versions
-- creates: public.agent_loop_runs
-- creates: public.agent_loop_iterations
-- creates: public.agent_loop_judgments
-- creates: public.agent_loop_evidence
-- creates: public.agent_loops_tenant_slug_uidx
-- creates: public.agent_loops_tenant_lifecycle_idx
-- creates: public.agent_loops_tenant_enabled_idx
-- creates: public.agent_loops_tenant_last_run_idx
-- creates: public.agent_loop_versions_loop_version_uidx
-- creates: public.agent_loop_versions_tenant_loop_idx
-- creates: public.agent_loop_runs_tenant_status_idx
-- creates: public.agent_loop_runs_loop_created_idx
-- creates: public.agent_loop_runs_tenant_correlation_idx
-- creates: public.agent_loop_runs_tenant_idempotency_uidx
-- creates: public.agent_loop_iterations_run_number_uidx
-- creates: public.agent_loop_iterations_tenant_status_idx
-- creates: public.agent_loop_iterations_wakeup_idx
-- creates: public.agent_loop_iterations_thread_turn_idx
-- creates: public.agent_loop_judgments_run_idx
-- creates: public.agent_loop_judgments_iteration_idx
-- creates: public.agent_loop_judgments_tenant_outcome_idx
-- creates: public.agent_loop_evidence_run_idx
-- creates: public.agent_loop_evidence_loop_idx
-- creates: public.agent_loop_evidence_iteration_idx
-- creates: public.agent_loop_evidence_source_idx
-- creates: public.idx_scheduled_jobs_agent_loop
-- creates-column: public.scheduled_jobs.agent_loop_id
-- creates-constraint: public.agent_loops.agent_loops_lifecycle_status_check
-- creates-constraint: public.agent_loops.agent_loops_trigger_family_check
-- creates-constraint: public.agent_loop_versions.agent_loop_versions_status_check
-- creates-constraint: public.agent_loop_runs.agent_loop_runs_status_check
-- creates-constraint: public.agent_loop_runs.agent_loop_runs_trigger_family_check
-- creates-constraint: public.agent_loop_iterations.agent_loop_iterations_status_check
-- creates-constraint: public.agent_loop_judgments.agent_loop_judgments_mode_check
-- creates-constraint: public.agent_loop_judgments.agent_loop_judgments_outcome_check
-- creates-constraint: public.agent_loop_evidence.agent_loop_evidence_redaction_state_check

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
  IF to_regclass('public.scheduled_jobs') IS NULL THEN
    RAISE EXCEPTION 'scheduled_jobs not found; apply scheduled job migrations first';
  END IF;
  IF to_regclass('public.agent_wakeup_requests') IS NULL THEN
    RAISE EXCEPTION 'agent_wakeup_requests not found; apply wakeup queue migrations first';
  END IF;
  IF to_regclass('public.thread_turns') IS NULL THEN
    RAISE EXCEPTION 'thread_turns not found; apply scheduled job execution migrations first';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.agent_loops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  lifecycle_status text NOT NULL DEFAULT 'draft',
  enabled boolean NOT NULL DEFAULT true,
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  owner_agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  primary_trigger_family text NOT NULL DEFAULT 'manual',
  current_version_id uuid,
  current_version_number integer,
  last_run_id uuid,
  last_run_status text,
  last_run_at timestamp with time zone,
  last_run_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  accepted_run_count integer NOT NULL DEFAULT 0,
  rejected_run_count integer NOT NULL DEFAULT 0,
  escalated_run_count integer NOT NULL DEFAULT 0,
  total_cost_usd_cents bigint NOT NULL DEFAULT 0,
  cost_per_accepted_run_usd_cents bigint,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT agent_loops_lifecycle_status_check CHECK (lifecycle_status IN ('draft', 'active', 'paused', 'archived')),
  CONSTRAINT agent_loops_trigger_family_check CHECK (primary_trigger_family IN ('manual', 'schedule', 'api', 'webhook', 'app_event', 'n8n'))
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_loops_tenant_slug_uidx
  ON public.agent_loops (tenant_id, slug);
CREATE INDEX IF NOT EXISTS agent_loops_tenant_lifecycle_idx
  ON public.agent_loops (tenant_id, lifecycle_status);
CREATE INDEX IF NOT EXISTS agent_loops_tenant_enabled_idx
  ON public.agent_loops (tenant_id, enabled);
CREATE INDEX IF NOT EXISTS agent_loops_tenant_last_run_idx
  ON public.agent_loops (tenant_id, last_run_at);

CREATE TABLE IF NOT EXISTS public.agent_loop_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  agent_loop_id uuid NOT NULL REFERENCES public.agent_loops(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  version_status text NOT NULL DEFAULT 'draft',
  trigger_spec jsonb NOT NULL,
  goal_spec jsonb NOT NULL,
  worker_spec jsonb NOT NULL,
  judge_spec jsonb NOT NULL,
  loop_policy jsonb NOT NULL,
  evidence_policy jsonb NOT NULL DEFAULT '{"redactionState":"summary_only","retainRawEvidence":false}'::jsonb,
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_actor_type text,
  created_by_actor_id uuid,
  published_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT agent_loop_versions_status_check CHECK (version_status IN ('draft', 'active', 'superseded', 'archived'))
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_loop_versions_loop_version_uidx
  ON public.agent_loop_versions (agent_loop_id, version_number);
CREATE INDEX IF NOT EXISTS agent_loop_versions_tenant_loop_idx
  ON public.agent_loop_versions (tenant_id, agent_loop_id);

CREATE TABLE IF NOT EXISTS public.agent_loop_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  agent_loop_id uuid NOT NULL REFERENCES public.agent_loops(id) ON DELETE CASCADE,
  agent_loop_version_id uuid REFERENCES public.agent_loop_versions(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued',
  trigger_family text NOT NULL,
  trigger_source text,
  scheduled_job_id uuid,
  actor_type text,
  actor_id uuid,
  idempotency_key text,
  correlation_id text,
  current_iteration integer NOT NULL DEFAULT 0,
  terminal_reason text,
  policy_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_summary jsonb,
  output_summary jsonb,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  last_event_at timestamp with time zone,
  error_code text,
  error_message text,
  total_cost_usd_cents bigint,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT agent_loop_runs_status_check CHECK (status IN ('queued', 'running', 'waiting_for_human', 'completed', 'failed', 'budget_stopped', 'escalated', 'canceled', 'skipped')),
  CONSTRAINT agent_loop_runs_trigger_family_check CHECK (trigger_family IN ('manual', 'schedule', 'api', 'webhook', 'app_event', 'n8n'))
);

CREATE INDEX IF NOT EXISTS agent_loop_runs_tenant_status_idx
  ON public.agent_loop_runs (tenant_id, status);
CREATE INDEX IF NOT EXISTS agent_loop_runs_loop_created_idx
  ON public.agent_loop_runs (agent_loop_id, created_at);
CREATE INDEX IF NOT EXISTS agent_loop_runs_tenant_correlation_idx
  ON public.agent_loop_runs (tenant_id, correlation_id);
CREATE UNIQUE INDEX IF NOT EXISTS agent_loop_runs_tenant_idempotency_uidx
  ON public.agent_loop_runs (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.agent_loop_iterations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  agent_loop_run_id uuid NOT NULL REFERENCES public.agent_loop_runs(id) ON DELETE CASCADE,
  iteration_number integer NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  goal_mode_action text,
  agent_wakeup_request_id uuid REFERENCES public.agent_wakeup_requests(id) ON DELETE SET NULL,
  thread_turn_id uuid REFERENCES public.thread_turns(id) ON DELETE SET NULL,
  input_summary jsonb,
  output_summary jsonb,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  error_code text,
  error_message text,
  total_cost_usd_cents bigint,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT agent_loop_iterations_status_check CHECK (status IN ('queued', 'running', 'completed', 'failed', 'budget_stopped', 'waiting_for_human', 'canceled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_loop_iterations_run_number_uidx
  ON public.agent_loop_iterations (agent_loop_run_id, iteration_number);
CREATE INDEX IF NOT EXISTS agent_loop_iterations_tenant_status_idx
  ON public.agent_loop_iterations (tenant_id, status);
CREATE INDEX IF NOT EXISTS agent_loop_iterations_wakeup_idx
  ON public.agent_loop_iterations (agent_wakeup_request_id);
CREATE INDEX IF NOT EXISTS agent_loop_iterations_thread_turn_idx
  ON public.agent_loop_iterations (thread_turn_id);

CREATE TABLE IF NOT EXISTS public.agent_loop_judgments (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  agent_loop_run_id uuid NOT NULL REFERENCES public.agent_loop_runs(id) ON DELETE CASCADE,
  agent_loop_iteration_id uuid REFERENCES public.agent_loop_iterations(id) ON DELETE CASCADE,
  judge_mode text NOT NULL,
  outcome text NOT NULL,
  confidence integer,
  rationale text,
  terminal_reason text,
  structured_output jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT agent_loop_judgments_mode_check CHECK (judge_mode IN ('self_check', 'human_approval', 'model_judge', 'reviewer_agent', 'eval_threshold', 'external_callback')),
  CONSTRAINT agent_loop_judgments_outcome_check CHECK (outcome IN ('complete', 'continue', 'failed', 'budget_stopped', 'needs_human_approval', 'escalated'))
);

CREATE INDEX IF NOT EXISTS agent_loop_judgments_run_idx
  ON public.agent_loop_judgments (agent_loop_run_id);
CREATE INDEX IF NOT EXISTS agent_loop_judgments_iteration_idx
  ON public.agent_loop_judgments (agent_loop_iteration_id);
CREATE INDEX IF NOT EXISTS agent_loop_judgments_tenant_outcome_idx
  ON public.agent_loop_judgments (tenant_id, outcome);

CREATE TABLE IF NOT EXISTS public.agent_loop_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  agent_loop_id uuid NOT NULL REFERENCES public.agent_loops(id) ON DELETE CASCADE,
  agent_loop_run_id uuid REFERENCES public.agent_loop_runs(id) ON DELETE CASCADE,
  agent_loop_iteration_id uuid REFERENCES public.agent_loop_iterations(id) ON DELETE SET NULL,
  agent_loop_judgment_id bigint REFERENCES public.agent_loop_judgments(id) ON DELETE SET NULL,
  evidence_type text NOT NULL,
  source_system text NOT NULL,
  source_id text,
  uri text,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  redaction_state text NOT NULL DEFAULT 'summary_only',
  sensitivity text,
  retention_expires_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT agent_loop_evidence_redaction_state_check CHECK (redaction_state IN ('summary_only', 'redacted', 'offloaded', 'raw_allowed'))
);

CREATE INDEX IF NOT EXISTS agent_loop_evidence_run_idx
  ON public.agent_loop_evidence (agent_loop_run_id);
CREATE INDEX IF NOT EXISTS agent_loop_evidence_loop_idx
  ON public.agent_loop_evidence (agent_loop_id);
CREATE INDEX IF NOT EXISTS agent_loop_evidence_iteration_idx
  ON public.agent_loop_evidence (agent_loop_iteration_id);
CREATE INDEX IF NOT EXISTS agent_loop_evidence_source_idx
  ON public.agent_loop_evidence (tenant_id, source_system, source_id);

ALTER TABLE public.scheduled_jobs
  ADD COLUMN IF NOT EXISTS agent_loop_id uuid;

CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_agent_loop
  ON public.scheduled_jobs (agent_loop_id);
