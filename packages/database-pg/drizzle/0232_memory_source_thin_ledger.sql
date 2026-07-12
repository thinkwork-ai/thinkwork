-- THINK-193 U1: external-memory-compounding thin ledger.
-- Contents:
--   * memory_processor_configs — one processor per shared scope (partial
--     unique on active target).
--   * memory_source_configs — source bindings under a processor.
--   * memory_source_checkpoints — CAS cursor per source partition.
--   * memory_evidence_items — evidence ledger with lifecycle + lineage inputs.
--   * memory_run_items — per-run stage idempotency ledger.
--   * memory_derivations — evidence -> Hindsight projection lineage.
--
-- NOT done here (deliberately): no claims tables, no identity tables —
-- thin U1 set only.
--
-- Hand-rolled (drizzle meta journal is not in use for this change);
-- apply with: psql "$DATABASE_URL" -f drizzle/0232_memory_source_thin_ledger.sql
-- creates: public.memory_processor_configs
-- creates: public.memory_source_configs
-- creates: public.memory_source_checkpoints
-- creates: public.memory_evidence_items
-- creates: public.memory_run_items
-- creates: public.memory_derivations

CREATE TABLE IF NOT EXISTS public.memory_processor_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  mode text NOT NULL,
  target_scope text NOT NULL,
  target_id uuid NOT NULL,
  workflow_id uuid REFERENCES public.workflows(id) ON DELETE SET NULL,
  enabled boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active',
  budget jsonb NOT NULL DEFAULT '{}'::jsonb,
  config_version integer NOT NULL DEFAULT 1,
  created_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memory_processor_configs_mode_check
    CHECK (mode IN ('personal', 'shared')),
  CONSTRAINT memory_processor_configs_target_scope_check
    CHECK (target_scope IN ('user', 'space', 'tenant')),
  CONSTRAINT memory_processor_configs_status_check
    CHECK (status IN ('active', 'disabled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS memory_processor_configs_active_target_uidx
  ON public.memory_processor_configs (tenant_id, mode, target_scope, target_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS memory_processor_configs_tenant_idx
  ON public.memory_processor_configs (tenant_id);

CREATE TABLE IF NOT EXISTS public.memory_source_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  processor_config_id uuid NOT NULL
    REFERENCES public.memory_processor_configs(id) ON DELETE CASCADE,
  source_family text NOT NULL,
  source_binding_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  boundary jsonb NOT NULL DEFAULT '{}'::jsonb,
  policy_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memory_source_configs_source_family_check
    CHECK (source_family IN ('twenty', 'firecrawl', 'email', 'bedrock_kb'))
);

CREATE UNIQUE INDEX IF NOT EXISTS memory_source_configs_binding_uidx
  ON public.memory_source_configs (processor_config_id, source_family, source_binding_key);

CREATE INDEX IF NOT EXISTS memory_source_configs_tenant_idx
  ON public.memory_source_configs (tenant_id);

CREATE TABLE IF NOT EXISTS public.memory_source_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_config_id uuid NOT NULL
    REFERENCES public.memory_source_configs(id) ON DELETE CASCADE,
  partition_key text NOT NULL,
  "cursor" jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 0,
  last_advanced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS memory_source_checkpoints_partition_uidx
  ON public.memory_source_checkpoints (source_config_id, partition_key);

CREATE TABLE IF NOT EXISTS public.memory_evidence_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_config_id uuid NOT NULL
    REFERENCES public.memory_source_configs(id) ON DELETE CASCADE,
  source_item_id text NOT NULL,
  source_version text NOT NULL,
  source_timestamp timestamptz,
  content_hash text NOT NULL,
  acquisition_run_id uuid REFERENCES public.workflow_runs(id) ON DELETE SET NULL,
  target_scope text NOT NULL,
  target_id uuid NOT NULL,
  lifecycle text NOT NULL DEFAULT 'active',
  sensitivity text,
  snapshot_ref text,
  normalized_snapshot jsonb,
  extraction_recipe jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memory_evidence_items_target_scope_check
    CHECK (target_scope IN ('space', 'tenant')),
  CONSTRAINT memory_evidence_items_lifecycle_check
    CHECK (lifecycle IN ('active', 'superseded', 'deleted', 'deferred', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS memory_evidence_items_source_version_uidx
  ON public.memory_evidence_items (source_config_id, source_item_id, source_version);

CREATE INDEX IF NOT EXISTS memory_evidence_items_tenant_idx
  ON public.memory_evidence_items (tenant_id);

CREATE INDEX IF NOT EXISTS memory_evidence_items_source_lifecycle_idx
  ON public.memory_evidence_items (source_config_id, lifecycle);

CREATE TABLE IF NOT EXISTS public.memory_run_items (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  workflow_run_id uuid NOT NULL
    REFERENCES public.workflow_runs(id) ON DELETE CASCADE,
  source_config_id uuid NOT NULL
    REFERENCES public.memory_source_configs(id) ON DELETE CASCADE,
  source_item_id text NOT NULL,
  stage text NOT NULL,
  result text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memory_run_items_stage_check
    CHECK (stage IN ('acquire', 'extract', 'project', 'resolve', 'retain', 'compound', 'graph', 'wiki', 'preflight')),
  CONSTRAINT memory_run_items_result_check
    CHECK (result IN ('seen', 'changed', 'retracted', 'deferred', 'failed', 'noop'))
);

CREATE UNIQUE INDEX IF NOT EXISTS memory_run_items_stage_uidx
  ON public.memory_run_items (workflow_run_id, source_config_id, source_item_id, stage);

CREATE INDEX IF NOT EXISTS memory_run_items_run_idx
  ON public.memory_run_items (workflow_run_id);

CREATE TABLE IF NOT EXISTS public.memory_derivations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_config_id uuid NOT NULL
    REFERENCES public.memory_source_configs(id) ON DELETE CASCADE,
  evidence_item_id uuid NOT NULL
    REFERENCES public.memory_evidence_items(id) ON DELETE CASCADE,
  projection_key text NOT NULL,
  target_bank_id text NOT NULL,
  hindsight_document_id text NOT NULL,
  current_version text NOT NULL,
  lifecycle text NOT NULL DEFAULT 'active',
  retracted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memory_derivations_lifecycle_check
    CHECK (lifecycle IN ('active', 'superseded', 'retracted'))
);

CREATE UNIQUE INDEX IF NOT EXISTS memory_derivations_active_projection_uidx
  ON public.memory_derivations (source_config_id, projection_key)
  WHERE lifecycle = 'active';

CREATE INDEX IF NOT EXISTS memory_derivations_tenant_idx
  ON public.memory_derivations (tenant_id);

CREATE INDEX IF NOT EXISTS memory_derivations_evidence_idx
  ON public.memory_derivations (evidence_item_id);
