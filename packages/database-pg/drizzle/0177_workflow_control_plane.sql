-- Workflow control-plane schema.
-- Plan: docs/plans/2026-06-20-001-feat-first-class-workflow-control-plane-plan.md (U1).
-- Apply manually (no CI migration runner):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0177_workflow_control_plane.sql
--
-- Pre-flight:
--   SELECT to_regclass('public.routines') AS routines;
--   SELECT to_regclass('public.routine_asl_versions') AS routine_asl_versions;
--   SELECT to_regclass('public.tenants') AS tenants;
--
-- creates: public.workflows
-- creates: public.workflow_versions
-- creates: public.workflow_triggers
-- creates: public.workflow_engine_bindings
-- creates: public.workflow_runs
-- creates: public.workflow_run_events
-- creates: public.workflow_evidence
-- creates: public.workflows_tenant_slug_uidx
-- creates: public.workflows_tenant_lifecycle_idx
-- creates: public.workflows_tenant_readiness_idx
-- creates: public.workflows_tenant_last_run_idx
-- creates: public.workflow_versions_workflow_version_uidx
-- creates: public.workflow_versions_tenant_workflow_idx
-- creates: public.workflow_versions_routine_asl_idx
-- creates: public.workflow_triggers_workflow_enabled_idx
-- creates: public.workflow_triggers_tenant_family_idx
-- creates: public.workflow_engine_bindings_workflow_idx
-- creates: public.workflow_engine_bindings_tenant_type_idx
-- creates: public.workflow_engine_bindings_step_routine_uidx
-- creates: public.workflow_engine_bindings_external_uidx
-- creates: public.workflow_runs_tenant_status_idx
-- creates: public.workflow_runs_workflow_created_idx
-- creates: public.workflow_runs_tenant_correlation_idx
-- creates: public.workflow_runs_tenant_idempotency_uidx
-- creates: public.workflow_run_events_run_occurred_idx
-- creates: public.workflow_run_events_tenant_type_idx
-- creates: public.workflow_evidence_run_idx
-- creates: public.workflow_evidence_workflow_idx
-- creates: public.workflow_evidence_source_idx
-- creates-constraint: public.workflows.workflows_lifecycle_status_check
-- creates-constraint: public.workflows.workflows_visibility_check
-- creates-constraint: public.workflows.workflows_trigger_family_check
-- creates-constraint: public.workflows.workflows_readiness_state_check
-- creates-constraint: public.workflow_versions.workflow_versions_status_check
-- creates-constraint: public.workflow_triggers.workflow_triggers_family_check
-- creates-constraint: public.workflow_triggers.workflow_triggers_readiness_state_check
-- creates-constraint: public.workflow_engine_bindings.workflow_engine_bindings_type_check
-- creates-constraint: public.workflow_engine_bindings.workflow_engine_bindings_status_check
-- creates-constraint: public.workflow_engine_bindings.workflow_engine_bindings_readiness_state_check
-- creates-constraint: public.workflow_runs.workflow_runs_status_check
-- creates-constraint: public.workflow_run_events.workflow_run_events_provenance_check
-- creates-constraint: public.workflow_evidence.workflow_evidence_redaction_state_check

CREATE TABLE IF NOT EXISTS public.workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  lifecycle_status text NOT NULL DEFAULT 'draft',
  visibility text NOT NULL DEFAULT 'tenant_shared',
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  owner_agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  primary_trigger_family text NOT NULL DEFAULT 'manual',
  current_version_id uuid,
  current_version_number integer,
  capability_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  readiness_state text NOT NULL DEFAULT 'unknown',
  readiness_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_run_id uuid,
  last_run_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT workflows_lifecycle_status_check CHECK (lifecycle_status IN ('draft', 'active', 'deprecated', 'archived')),
  CONSTRAINT workflows_visibility_check CHECK (visibility IN ('agent_private', 'tenant_shared')),
  CONSTRAINT workflows_trigger_family_check CHECK (primary_trigger_family IN ('manual', 'schedule', 'webhook', 'crm', 'n8n', 'api', 'agent', 'child_workflow')),
  CONSTRAINT workflows_readiness_state_check CHECK (readiness_state IN ('unknown', 'ready', 'blocked_not_ready', 'disabled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS workflows_tenant_slug_uidx
  ON public.workflows (tenant_id, slug);
CREATE INDEX IF NOT EXISTS workflows_tenant_lifecycle_idx
  ON public.workflows (tenant_id, lifecycle_status);
CREATE INDEX IF NOT EXISTS workflows_tenant_readiness_idx
  ON public.workflows (tenant_id, readiness_state);
CREATE INDEX IF NOT EXISTS workflows_tenant_last_run_idx
  ON public.workflows (tenant_id, last_run_at);

CREATE TABLE IF NOT EXISTS public.workflow_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  version_status text NOT NULL DEFAULT 'draft',
  source_kind text NOT NULL DEFAULT 'workflow_control_plane',
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  definition_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  capability_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  routine_asl_version_id uuid REFERENCES public.routine_asl_versions(id) ON DELETE SET NULL,
  created_by_actor_type text,
  created_by_actor_id uuid,
  published_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT workflow_versions_status_check CHECK (version_status IN ('draft', 'active', 'superseded', 'archived'))
);

CREATE UNIQUE INDEX IF NOT EXISTS workflow_versions_workflow_version_uidx
  ON public.workflow_versions (workflow_id, version_number);
CREATE INDEX IF NOT EXISTS workflow_versions_tenant_workflow_idx
  ON public.workflow_versions (tenant_id, workflow_id);
CREATE INDEX IF NOT EXISTS workflow_versions_routine_asl_idx
  ON public.workflow_versions (routine_asl_version_id);

CREATE TABLE IF NOT EXISTS public.workflow_triggers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  workflow_version_id uuid REFERENCES public.workflow_versions(id) ON DELETE SET NULL,
  trigger_family text NOT NULL,
  source_system text,
  enabled boolean NOT NULL DEFAULT true,
  idempotency_required boolean NOT NULL DEFAULT true,
  trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_contract jsonb NOT NULL DEFAULT '{}'::jsonb,
  readiness_state text NOT NULL DEFAULT 'unknown',
  readiness_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT workflow_triggers_family_check CHECK (trigger_family IN ('manual', 'schedule', 'webhook', 'crm', 'n8n', 'api', 'agent', 'child_workflow')),
  CONSTRAINT workflow_triggers_readiness_state_check CHECK (readiness_state IN ('unknown', 'ready', 'blocked_not_ready', 'disabled'))
);

CREATE INDEX IF NOT EXISTS workflow_triggers_workflow_enabled_idx
  ON public.workflow_triggers (workflow_id, enabled);
CREATE INDEX IF NOT EXISTS workflow_triggers_tenant_family_idx
  ON public.workflow_triggers (tenant_id, trigger_family);

CREATE TABLE IF NOT EXISTS public.workflow_engine_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  workflow_version_id uuid REFERENCES public.workflow_versions(id) ON DELETE SET NULL,
  binding_type text NOT NULL,
  binding_status text NOT NULL DEFAULT 'configured',
  routine_id uuid REFERENCES public.routines(id) ON DELETE SET NULL,
  routine_asl_version_id uuid REFERENCES public.routine_asl_versions(id) ON DELETE SET NULL,
  plugin_install_id uuid REFERENCES public.plugin_installs(id) ON DELETE SET NULL,
  managed_application_id uuid REFERENCES public.managed_applications(id) ON DELETE SET NULL,
  external_workflow_id text,
  external_workflow_name text,
  external_version_id text,
  connection_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  capability_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  readiness_state text NOT NULL DEFAULT 'unknown',
  readiness_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT workflow_engine_bindings_type_check CHECK (binding_type IN ('step_functions_routine', 'n8n_bridge', 'n8n_import', 'twenty_crm', 'connected_app', 'native')),
  CONSTRAINT workflow_engine_bindings_status_check CHECK (binding_status IN ('configured', 'ready', 'blocked_not_ready', 'disabled', 'archived')),
  CONSTRAINT workflow_engine_bindings_readiness_state_check CHECK (readiness_state IN ('unknown', 'ready', 'blocked_not_ready', 'disabled'))
);

CREATE INDEX IF NOT EXISTS workflow_engine_bindings_workflow_idx
  ON public.workflow_engine_bindings (workflow_id);
CREATE INDEX IF NOT EXISTS workflow_engine_bindings_tenant_type_idx
  ON public.workflow_engine_bindings (tenant_id, binding_type);
CREATE UNIQUE INDEX IF NOT EXISTS workflow_engine_bindings_step_routine_uidx
  ON public.workflow_engine_bindings (tenant_id, routine_id)
  WHERE routine_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS workflow_engine_bindings_external_uidx
  ON public.workflow_engine_bindings (tenant_id, binding_type, external_workflow_id)
  WHERE external_workflow_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  workflow_version_id uuid REFERENCES public.workflow_versions(id) ON DELETE SET NULL,
  engine_binding_id uuid REFERENCES public.workflow_engine_bindings(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued',
  trigger_family text NOT NULL,
  trigger_source text,
  actor_type text,
  actor_id uuid,
  idempotency_key text,
  correlation_id text,
  backend_execution_id text,
  backend_execution_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  capability_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  readiness_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
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
  CONSTRAINT workflow_runs_status_check CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'canceled', 'timed_out', 'blocked_not_ready'))
);

CREATE INDEX IF NOT EXISTS workflow_runs_tenant_status_idx
  ON public.workflow_runs (tenant_id, status);
CREATE INDEX IF NOT EXISTS workflow_runs_workflow_created_idx
  ON public.workflow_runs (workflow_id, created_at);
CREATE INDEX IF NOT EXISTS workflow_runs_tenant_correlation_idx
  ON public.workflow_runs (tenant_id, correlation_id);
CREATE UNIQUE INDEX IF NOT EXISTS workflow_runs_tenant_idempotency_uidx
  ON public.workflow_runs (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.workflow_run_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  workflow_run_id uuid NOT NULL REFERENCES public.workflow_runs(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_status text,
  provenance text NOT NULL,
  occurred_at timestamp with time zone NOT NULL DEFAULT now(),
  message text,
  payload_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT workflow_run_events_provenance_check CHECK (provenance IN ('native_event', 'app_callback', 'engine_history', 'output_inferred', 'operator_decision'))
);

CREATE INDEX IF NOT EXISTS workflow_run_events_run_occurred_idx
  ON public.workflow_run_events (workflow_run_id, occurred_at);
CREATE INDEX IF NOT EXISTS workflow_run_events_tenant_type_idx
  ON public.workflow_run_events (tenant_id, event_type);

CREATE TABLE IF NOT EXISTS public.workflow_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  workflow_run_id uuid REFERENCES public.workflow_runs(id) ON DELETE CASCADE,
  evidence_type text NOT NULL,
  source_system text NOT NULL,
  source_id text,
  uri text,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  redaction_state text NOT NULL DEFAULT 'summary_only',
  sensitivity text,
  retention_expires_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT workflow_evidence_redaction_state_check CHECK (redaction_state IN ('summary_only', 'redacted', 'offloaded', 'raw_allowed'))
);

CREATE INDEX IF NOT EXISTS workflow_evidence_run_idx
  ON public.workflow_evidence (workflow_run_id);
CREATE INDEX IF NOT EXISTS workflow_evidence_workflow_idx
  ON public.workflow_evidence (workflow_id);
CREATE INDEX IF NOT EXISTS workflow_evidence_source_idx
  ON public.workflow_evidence (tenant_id, source_system, source_id);
