-- System Workflows Step Functions foundation.
--
-- Adds the platform-owned workflow tables that back Automations ->
-- System Workflows. These tables intentionally do not reuse the Routine
-- tables: routines are tenant/agent-authored workflows, while system
-- workflows are ThinkWork-owned controls with governed config,
-- extension points, evidence, and compliance semantics.
--
-- Plan:
--   docs/plans/2026-05-02-007-feat-system-workflows-step-functions-plan.md
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0059_system_workflows.sql
--
-- creates: public.system_workflow_definitions
-- creates: public.system_workflow_configs
-- creates: public.system_workflow_extension_bindings
-- creates: public.system_workflow_runs
-- creates: public.system_workflow_step_events
-- creates: public.system_workflow_evidence
-- creates: public.system_workflow_change_events
-- creates: public.idx_system_workflow_definitions_category
-- creates: public.idx_system_workflow_definitions_status
-- creates: public.idx_system_workflow_configs_tenant_workflow_version
-- creates: public.idx_system_workflow_configs_tenant_workflow_status
-- creates: public.idx_system_workflow_extension_bindings_tenant_workflow
-- creates: public.idx_system_workflow_extension_bindings_config
-- creates: public.idx_system_workflow_runs_sfn_arn
-- creates: public.idx_system_workflow_runs_tenant_workflow_started
-- creates: public.idx_system_workflow_runs_tenant_status
-- creates: public.idx_system_workflow_runs_domain_ref
-- creates: public.idx_system_workflow_step_events_run
-- creates: public.idx_system_workflow_step_events_dedup
-- creates: public.idx_system_workflow_step_events_tenant_step
-- creates: public.idx_system_workflow_evidence_run
-- creates: public.idx_system_workflow_evidence_tenant_type
-- creates: public.idx_system_workflow_evidence_dedup
-- creates: public.idx_system_workflow_change_events_tenant_workflow
-- creates: public.idx_system_workflow_change_events_run

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS public.system_workflow_definitions (
  id text PRIMARY KEY NOT NULL,
  name text NOT NULL,
  description text,
  category text NOT NULL,
  owner text NOT NULL DEFAULT 'ThinkWork',
  runtime_shape text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  active_version text NOT NULL,
  config_schema_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  extension_points_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_contract_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  step_manifest_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_workflow_definitions_category
  ON public.system_workflow_definitions (category);
CREATE INDEX IF NOT EXISTS idx_system_workflow_definitions_status
  ON public.system_workflow_definitions (status);

INSERT INTO public.system_workflow_definitions (
  id,
  name,
  description,
  category,
  owner,
  runtime_shape,
  status,
  active_version,
  config_schema_json,
  extension_points_json,
  evidence_contract_json,
  step_manifest_json
) VALUES
  (
    'wiki-build',
    'Wiki Build Process',
    'Compiles memory into durable wiki pages with checkpoints, quality gates, and rebuild approval support.',
    'knowledge',
    'ThinkWork',
    'HYBRID',
    'active',
    '2026-05-02.v1',
    '[{"key":"destructiveRebuildRequiresApproval","label":"Require approval for destructive rebuilds","inputType":"boolean","required":true,"defaultValue":true},{"key":"qualityGateThreshold","label":"Quality gate threshold","inputType":"number","required":true,"defaultValue":0.85},{"key":"plannerModel","label":"Planner model","inputType":"string","required":false}]'::jsonb,
    '[{"id":"pre-rebuild-approval","label":"Pre-rebuild approval","description":"Optional human approval before destructive rebuilds.","hookType":"approval_gate","required":false},{"id":"post-compile-validation","label":"Post-compile validation","description":"Tenant validation hook after pages and links are emitted.","hookType":"validation","required":false}]'::jsonb,
    '[{"type":"compile-summary","label":"Compile summary","description":"Compile job id, owner scope, page/link deltas, and final status.","required":true},{"type":"quality-gates","label":"Quality gates","description":"Planner/linking checks and threshold outcomes.","required":true}]'::jsonb,
    '[{"nodeId":"ClaimCompileJob","label":"Claim compile job","stepType":"checkpoint","runtime":"standard"},{"nodeId":"CompilePages","label":"Compile pages","stepType":"worker","runtime":"express"},{"nodeId":"ValidateGraph","label":"Validate graph","stepType":"validation","runtime":"express"},{"nodeId":"PublishEvidence","label":"Publish evidence","stepType":"evidence","runtime":"standard"}]'::jsonb
  ),
  (
    'evaluation-runs',
    'Evaluation Runs',
    'Coordinates test-pack snapshots, scorer batches, pass/fail gates, trace lookup, and evidence for agent evaluations.',
    'quality',
    'ThinkWork',
    'HYBRID',
    'active',
    '2026-05-02.v1',
    '[{"key":"passRateThreshold","label":"Pass-rate threshold","inputType":"number","required":true,"defaultValue":0.9},{"key":"maxBatchSize","label":"Max test cases per batch","inputType":"number","required":true,"defaultValue":25},{"key":"preRunConnectorCheck","label":"Run connector readiness check","inputType":"boolean","required":true,"defaultValue":true}]'::jsonb,
    '[{"id":"pre-run-check","label":"Pre-run check","description":"Optional tenant hook before evaluation batches start.","hookType":"pre_check","required":false},{"id":"failure-notification","label":"Failure notification","description":"Notification hook when a run fails threshold gates.","hookType":"notification","required":false}]'::jsonb,
    '[{"type":"test-pack-snapshot","label":"Test pack snapshot","description":"The tests and categories selected for this run.","required":true},{"type":"score-summary","label":"Score summary","description":"Evaluator outcomes, pass-rate gate, and cost summary.","required":true}]'::jsonb,
    '[{"nodeId":"SnapshotTestPack","label":"Snapshot test pack","stepType":"checkpoint","runtime":"standard"},{"nodeId":"RunBatches","label":"Run test batches","stepType":"worker","runtime":"express"},{"nodeId":"AggregateScores","label":"Aggregate scores","stepType":"aggregation","runtime":"standard"},{"nodeId":"ApplyPassFailGate","label":"Apply pass/fail gate","stepType":"gate","runtime":"standard"}]'::jsonb
  ),
  (
    'tenant-agent-activation',
    'Tenant/Agent Activation',
    'Tracks activation readiness, connector checks, policy attestations, apply work, and launch approval.',
    'activation',
    'ThinkWork',
    'STANDARD_PARENT',
    'active',
    '2026-05-02.v1',
    '[{"key":"securityAttestationRequired","label":"Require security attestation","inputType":"boolean","required":true,"defaultValue":true},{"key":"requiredConnectors","label":"Required connectors","inputType":"json","required":false,"defaultValue":[]},{"key":"launchApprovalRole","label":"Launch approval role","inputType":"select","required":true,"defaultValue":"admin","options":["admin","owner"]}]'::jsonb,
    '[{"id":"connector-readiness-check","label":"Connector readiness check","description":"Optional readiness hook before launch approval.","hookType":"pre_check","required":false},{"id":"security-attestation","label":"Security attestation","description":"Human attestation gate before activation launch.","hookType":"approval_gate","required":false}]'::jsonb,
    '[{"type":"activation-timeline","label":"Activation timeline","description":"Layer progress, checkpoints, and apply outcomes.","required":true},{"type":"launch-approval","label":"Launch approval","description":"Approval and attestation decisions for launch.","required":true}]'::jsonb,
    '[{"nodeId":"TrackReadiness","label":"Track readiness","stepType":"checkpoint","runtime":"standard"},{"nodeId":"RunPolicyChecks","label":"Run policy checks","stepType":"validation","runtime":"standard"},{"nodeId":"ApplyActivationBundle","label":"Apply activation bundle","stepType":"worker","runtime":"standard"},{"nodeId":"RecordLaunchDecision","label":"Record launch decision","stepType":"evidence","runtime":"standard"}]'::jsonb
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  owner = EXCLUDED.owner,
  runtime_shape = EXCLUDED.runtime_shape,
  status = EXCLUDED.status,
  active_version = EXCLUDED.active_version,
  config_schema_json = EXCLUDED.config_schema_json,
  extension_points_json = EXCLUDED.extension_points_json,
  evidence_contract_json = EXCLUDED.evidence_contract_json,
  step_manifest_json = EXCLUDED.step_manifest_json,
  updated_at = now();

CREATE TABLE IF NOT EXISTS public.system_workflow_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  workflow_id text NOT NULL REFERENCES public.system_workflow_definitions(id),
  version_number integer NOT NULL,
  status text NOT NULL DEFAULT 'active',
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_actor_id uuid,
  created_by_actor_type text,
  activated_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_system_workflow_configs_tenant_workflow_version
  ON public.system_workflow_configs (tenant_id, workflow_id, version_number);
CREATE INDEX IF NOT EXISTS idx_system_workflow_configs_tenant_workflow_status
  ON public.system_workflow_configs (tenant_id, workflow_id, status);

CREATE TABLE IF NOT EXISTS public.system_workflow_extension_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  workflow_id text NOT NULL REFERENCES public.system_workflow_definitions(id),
  config_id uuid REFERENCES public.system_workflow_configs(id) ON DELETE SET NULL,
  extension_point_id text NOT NULL,
  binding_type text NOT NULL,
  binding_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_workflow_extension_bindings_tenant_workflow
  ON public.system_workflow_extension_bindings (tenant_id, workflow_id);
CREATE INDEX IF NOT EXISTS idx_system_workflow_extension_bindings_config
  ON public.system_workflow_extension_bindings (config_id);

CREATE TABLE IF NOT EXISTS public.system_workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  workflow_id text NOT NULL REFERENCES public.system_workflow_definitions(id),
  config_id uuid REFERENCES public.system_workflow_configs(id) ON DELETE SET NULL,
  definition_version text NOT NULL,
  runtime_shape text NOT NULL,
  state_machine_arn text,
  alias_arn text,
  version_arn text,
  sfn_execution_arn text,
  trigger_id uuid REFERENCES public.scheduled_jobs(id) ON DELETE SET NULL,
  trigger_source text NOT NULL,
  actor_id uuid,
  actor_type text,
  domain_ref_type text,
  domain_ref_id text,
  input_json jsonb,
  output_json jsonb,
  evidence_summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'running',
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  error_code text,
  error_message text,
  total_cost_usd_cents bigint,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_system_workflow_runs_sfn_arn
  ON public.system_workflow_runs (sfn_execution_arn);
CREATE INDEX IF NOT EXISTS idx_system_workflow_runs_tenant_workflow_started
  ON public.system_workflow_runs (tenant_id, workflow_id, started_at);
CREATE INDEX IF NOT EXISTS idx_system_workflow_runs_tenant_status
  ON public.system_workflow_runs (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_system_workflow_runs_domain_ref
  ON public.system_workflow_runs (tenant_id, domain_ref_type, domain_ref_id);

CREATE TABLE IF NOT EXISTS public.system_workflow_step_events (
  id bigserial PRIMARY KEY NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.system_workflow_runs(id) ON DELETE CASCADE,
  node_id text NOT NULL,
  step_type text NOT NULL,
  status text NOT NULL,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  input_json jsonb,
  output_json jsonb,
  error_json jsonb,
  cost_usd_cents bigint,
  retry_count integer NOT NULL DEFAULT 0,
  idempotency_key text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_workflow_step_events_run
  ON public.system_workflow_step_events (run_id, started_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_system_workflow_step_events_dedup
  ON public.system_workflow_step_events (run_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_system_workflow_step_events_tenant_step
  ON public.system_workflow_step_events (tenant_id, step_type);

CREATE TABLE IF NOT EXISTS public.system_workflow_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.system_workflow_runs(id) ON DELETE CASCADE,
  evidence_type text NOT NULL,
  title text NOT NULL,
  summary text,
  artifact_uri text,
  artifact_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  compliance_tags text[] NOT NULL DEFAULT '{}'::text[],
  idempotency_key text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_workflow_evidence_run
  ON public.system_workflow_evidence (run_id);
CREATE INDEX IF NOT EXISTS idx_system_workflow_evidence_tenant_type
  ON public.system_workflow_evidence (tenant_id, evidence_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_system_workflow_evidence_dedup
  ON public.system_workflow_evidence (run_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.system_workflow_change_events (
  id bigserial PRIMARY KEY NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  workflow_id text NOT NULL REFERENCES public.system_workflow_definitions(id),
  run_id uuid REFERENCES public.system_workflow_runs(id) ON DELETE SET NULL,
  actor_id uuid,
  actor_type text,
  change_type text NOT NULL,
  before_json jsonb,
  after_json jsonb,
  reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_workflow_change_events_tenant_workflow
  ON public.system_workflow_change_events (tenant_id, workflow_id);
CREATE INDEX IF NOT EXISTS idx_system_workflow_change_events_run
  ON public.system_workflow_change_events (run_id);

COMMIT;
