-- Purpose: add the Company Brain substrate contract tables used to report
--   storage tier, backend posture, migration state, operational counters, and
--   replayable artifact manifests.
-- Plan: docs/plans/2026-06-13-003-feat-company-brain-physical-substrate-plan.md U1
-- Apply manually (no CI migration runner):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0166_company_brain_substrate_contract.sql
-- Pre-flight:
--   SELECT to_regclass('brain.substrate_states');
--   SELECT to_regclass('public.managed_applications');
--   SELECT to_regclass('public.managed_application_deployment_jobs');
-- creates: brain.substrate_states
-- creates: brain.substrate_migrations
-- creates: brain.substrate_events
-- creates: brain.artifact_manifests
-- creates: brain.brain_substrate_states_tenant_uidx
-- creates: brain.brain_substrate_states_tenant_status_idx
-- creates: brain.brain_substrate_states_managed_app_idx
-- creates: brain.brain_substrate_states_latest_job_idx
-- creates: brain.brain_substrate_states_storage_tier_idx
-- creates: brain.brain_substrate_migrations_tenant_status_idx
-- creates: brain.brain_substrate_migrations_tenant_phase_idx
-- creates: brain.brain_substrate_migrations_substrate_created_idx
-- creates: brain.brain_substrate_migrations_job_idx
-- creates: brain.brain_substrate_events_tenant_created_idx
-- creates: brain.brain_substrate_events_substrate_created_idx
-- creates: brain.brain_substrate_events_migration_idx
-- creates: brain.brain_substrate_events_deployment_job_idx
-- creates: brain.brain_artifact_manifests_manifest_uri_uidx
-- creates: brain.brain_artifact_manifests_tenant_kind_idx
-- creates: brain.brain_artifact_manifests_substrate_kind_idx
-- creates: brain.brain_artifact_manifests_migration_idx
-- creates: brain.brain_artifact_manifests_source_idx
-- creates-constraint: brain.substrate_states.substrate_states_pkey
-- creates-constraint: brain.substrate_states.substrate_states_tenant_id_tenants_id_fk
-- creates-constraint: brain.substrate_states.substrate_states_managed_application_id_fk
-- creates-constraint: brain.substrate_states.substrate_states_latest_deployment_job_id_fk
-- creates-constraint: brain.substrate_states.brain_substrate_states_tier_allowed
-- creates-constraint: brain.substrate_states.brain_substrate_states_backend_allowed
-- creates-constraint: brain.substrate_states.brain_substrate_states_status_allowed
-- creates-constraint: brain.substrate_states.brain_substrate_states_health_allowed
-- creates-constraint: brain.substrate_states.brain_substrate_states_vector_positive
-- creates-constraint: brain.substrate_states.brain_substrate_states_queue_nonneg
-- creates-constraint: brain.substrate_states.brain_substrate_states_failed_nonneg
-- creates-constraint: brain.substrate_states.brain_substrate_states_entity_nonneg
-- creates-constraint: brain.substrate_states.brain_substrate_states_edge_nonneg
-- creates-constraint: brain.substrate_states.brain_substrate_states_artifact_nonneg
-- creates-constraint: brain.substrate_states.brain_substrate_states_projection_nonneg
-- creates-constraint: brain.substrate_migrations.substrate_migrations_pkey
-- creates-constraint: brain.substrate_migrations.substrate_migrations_tenant_id_tenants_id_fk
-- creates-constraint: brain.substrate_migrations.substrate_migrations_substrate_id_fk
-- creates-constraint: brain.substrate_migrations.substrate_migrations_requested_by_user_id_fk
-- creates-constraint: brain.substrate_migrations.substrate_migrations_deployment_job_id_fk
-- creates-constraint: brain.substrate_migrations.brain_substrate_migrations_from_tier_allowed
-- creates-constraint: brain.substrate_migrations.brain_substrate_migrations_to_tier_allowed
-- creates-constraint: brain.substrate_migrations.brain_substrate_migrations_phase_allowed
-- creates-constraint: brain.substrate_migrations.brain_substrate_migrations_status_allowed
-- creates-constraint: brain.substrate_migrations.brain_substrate_migrations_vector_positive
-- creates-constraint: brain.substrate_events.substrate_events_pkey
-- creates-constraint: brain.substrate_events.substrate_events_tenant_id_tenants_id_fk
-- creates-constraint: brain.substrate_events.substrate_events_substrate_id_fk
-- creates-constraint: brain.substrate_events.substrate_events_migration_id_fk
-- creates-constraint: brain.substrate_events.substrate_events_deployment_job_id_fk
-- creates-constraint: brain.artifact_manifests.artifact_manifests_pkey
-- creates-constraint: brain.artifact_manifests.artifact_manifests_tenant_id_tenants_id_fk
-- creates-constraint: brain.artifact_manifests.artifact_manifests_substrate_id_fk
-- creates-constraint: brain.artifact_manifests.artifact_manifests_migration_id_fk
-- creates-constraint: brain.artifact_manifests.brain_artifact_manifests_kind_allowed
-- creates-constraint: brain.artifact_manifests.brain_artifact_manifests_tier_allowed
-- creates-constraint: brain.artifact_manifests.brain_artifact_manifests_status_allowed
-- creates-constraint: brain.artifact_manifests.brain_artifact_manifests_object_nonneg
-- creates-constraint: brain.artifact_manifests.brain_artifact_manifests_source_nonneg
-- creates-constraint: brain.artifact_manifests.brain_artifact_manifests_vector_positive

\set ON_ERROR_STOP on

SET lock_timeout = '5s';
SET statement_timeout = '15min';

SELECT pg_advisory_lock(hashtext('migration:0166_company_brain_substrate_contract'));

CREATE SCHEMA IF NOT EXISTS brain;

-- ---------------------------------------------------------------------------
-- brain.substrate_states — per-tenant Company Brain substrate posture
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS brain.substrate_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  managed_application_id uuid,
  latest_deployment_job_id uuid,
  storage_tier text NOT NULL DEFAULT 'default',
  active_backend text NOT NULL DEFAULT 'none',
  status text NOT NULL DEFAULT 'not_installed',
  health_status text NOT NULL DEFAULT 'unknown',
  backend_mode text,
  graph_provider text,
  vector_provider text,
  embedding_model text,
  vector_dimension integer,
  cognee_version text,
  cognee_endpoint text,
  s3_artifact_root text,
  s3_manifest_root text,
  s3_vault_projection_root text,
  neptune_graph_id text,
  neptune_endpoint text,
  efs_file_system_id text,
  production_posture text,
  latest_ingest_at timestamptz,
  latest_projection_at timestamptz,
  ingestion_queue_depth integer NOT NULL DEFAULT 0,
  failed_ingest_count integer NOT NULL DEFAULT 0,
  graph_entity_count integer,
  graph_edge_count integer,
  source_artifact_count integer,
  vault_projection_count integer,
  ontology_version text,
  launch_capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  optional_capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  operator_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_failure_message text,
  last_failure_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT substrate_states_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT substrate_states_managed_application_id_fk
    FOREIGN KEY (managed_application_id)
    REFERENCES public.managed_applications(id)
    ON DELETE SET NULL,
  CONSTRAINT substrate_states_latest_deployment_job_id_fk
    FOREIGN KEY (latest_deployment_job_id)
    REFERENCES public.managed_application_deployment_jobs(id)
    ON DELETE SET NULL,
  CONSTRAINT brain_substrate_states_tier_allowed
    CHECK (storage_tier IN ('default', 'production')),
  CONSTRAINT brain_substrate_states_backend_allowed
    CHECK (active_backend IN ('none', 'default', 'production', 'legacy_cognee')),
  CONSTRAINT brain_substrate_states_status_allowed
    CHECK (status IN (
      'not_installed',
      'provisioning',
      'ready',
      'degraded',
      'failed',
      'migrating',
      'disabled'
    )),
  CONSTRAINT brain_substrate_states_health_allowed
    CHECK (health_status IN ('unknown', 'healthy', 'degraded', 'failed', 'disabled')),
  CONSTRAINT brain_substrate_states_vector_positive
    CHECK (vector_dimension IS NULL OR vector_dimension > 0),
  CONSTRAINT brain_substrate_states_queue_nonneg
    CHECK (ingestion_queue_depth >= 0),
  CONSTRAINT brain_substrate_states_failed_nonneg
    CHECK (failed_ingest_count >= 0),
  CONSTRAINT brain_substrate_states_entity_nonneg
    CHECK (graph_entity_count IS NULL OR graph_entity_count >= 0),
  CONSTRAINT brain_substrate_states_edge_nonneg
    CHECK (graph_edge_count IS NULL OR graph_edge_count >= 0),
  CONSTRAINT brain_substrate_states_artifact_nonneg
    CHECK (source_artifact_count IS NULL OR source_artifact_count >= 0),
  CONSTRAINT brain_substrate_states_projection_nonneg
    CHECK (vault_projection_count IS NULL OR vault_projection_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS brain_substrate_states_tenant_uidx
  ON brain.substrate_states (tenant_id);

CREATE INDEX IF NOT EXISTS brain_substrate_states_tenant_status_idx
  ON brain.substrate_states (tenant_id, status);

CREATE INDEX IF NOT EXISTS brain_substrate_states_managed_app_idx
  ON brain.substrate_states (managed_application_id);

CREATE INDEX IF NOT EXISTS brain_substrate_states_latest_job_idx
  ON brain.substrate_states (latest_deployment_job_id);

CREATE INDEX IF NOT EXISTS brain_substrate_states_storage_tier_idx
  ON brain.substrate_states (storage_tier);

-- ---------------------------------------------------------------------------
-- brain.substrate_migrations — storage-tier migration/cutover state
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS brain.substrate_migrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  substrate_id uuid,
  from_storage_tier text NOT NULL DEFAULT 'default',
  to_storage_tier text NOT NULL DEFAULT 'production',
  phase text NOT NULL DEFAULT 'none',
  status text NOT NULL DEFAULT 'none',
  requested_by_user_id uuid,
  deployment_job_id uuid,
  embedding_model text,
  vector_dimension integer,
  validation_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  operator_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  rollback_window_closes_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT substrate_migrations_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT substrate_migrations_substrate_id_fk
    FOREIGN KEY (substrate_id)
    REFERENCES brain.substrate_states(id)
    ON DELETE SET NULL,
  CONSTRAINT substrate_migrations_requested_by_user_id_fk
    FOREIGN KEY (requested_by_user_id)
    REFERENCES public.users(id)
    ON DELETE SET NULL,
  CONSTRAINT substrate_migrations_deployment_job_id_fk
    FOREIGN KEY (deployment_job_id)
    REFERENCES public.managed_application_deployment_jobs(id)
    ON DELETE SET NULL,
  CONSTRAINT brain_substrate_migrations_from_tier_allowed
    CHECK (from_storage_tier IN ('default', 'production')),
  CONSTRAINT brain_substrate_migrations_to_tier_allowed
    CHECK (to_storage_tier IN ('default', 'production')),
  CONSTRAINT brain_substrate_migrations_phase_allowed
    CHECK (phase IN (
      'none',
      'requested',
      'snapshotting',
      'provisioning',
      'replaying',
      'validating',
      'cutover',
      'completed',
      'failed',
      'rolled_back'
    )),
  CONSTRAINT brain_substrate_migrations_status_allowed
    CHECK (status IN (
      'none',
      'requested',
      'running',
      'completed',
      'failed',
      'rolled_back',
      'canceled'
    )),
  CONSTRAINT brain_substrate_migrations_vector_positive
    CHECK (vector_dimension IS NULL OR vector_dimension > 0)
);

CREATE INDEX IF NOT EXISTS brain_substrate_migrations_tenant_status_idx
  ON brain.substrate_migrations (tenant_id, status);

CREATE INDEX IF NOT EXISTS brain_substrate_migrations_tenant_phase_idx
  ON brain.substrate_migrations (tenant_id, phase);

CREATE INDEX IF NOT EXISTS brain_substrate_migrations_substrate_created_idx
  ON brain.substrate_migrations (substrate_id, created_at);

CREATE INDEX IF NOT EXISTS brain_substrate_migrations_job_idx
  ON brain.substrate_migrations (deployment_job_id);

-- ---------------------------------------------------------------------------
-- brain.substrate_events — operational substrate event log
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS brain.substrate_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  substrate_id uuid,
  migration_id uuid,
  deployment_job_id uuid,
  event_type text NOT NULL,
  message text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_uri text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT substrate_events_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT substrate_events_substrate_id_fk
    FOREIGN KEY (substrate_id)
    REFERENCES brain.substrate_states(id)
    ON DELETE CASCADE,
  CONSTRAINT substrate_events_migration_id_fk
    FOREIGN KEY (migration_id)
    REFERENCES brain.substrate_migrations(id)
    ON DELETE SET NULL,
  CONSTRAINT substrate_events_deployment_job_id_fk
    FOREIGN KEY (deployment_job_id)
    REFERENCES public.managed_application_deployment_jobs(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS brain_substrate_events_tenant_created_idx
  ON brain.substrate_events (tenant_id, created_at);

CREATE INDEX IF NOT EXISTS brain_substrate_events_substrate_created_idx
  ON brain.substrate_events (substrate_id, created_at);

CREATE INDEX IF NOT EXISTS brain_substrate_events_migration_idx
  ON brain.substrate_events (migration_id);

CREATE INDEX IF NOT EXISTS brain_substrate_events_deployment_job_idx
  ON brain.substrate_events (deployment_job_id);

-- ---------------------------------------------------------------------------
-- brain.artifact_manifests — replayable Brain source/vault manifests
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS brain.artifact_manifests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  substrate_id uuid,
  migration_id uuid,
  manifest_kind text NOT NULL,
  storage_tier text NOT NULL DEFAULT 'default',
  source_family text,
  source_id_hash text,
  manifest_uri text NOT NULL,
  artifact_root_uri text,
  vault_projection_root_uri text,
  checksum_sha256 text,
  object_count integer NOT NULL DEFAULT 0,
  source_count integer NOT NULL DEFAULT 0,
  embedding_model text,
  vector_dimension integer,
  ontology_version text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artifact_manifests_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT artifact_manifests_substrate_id_fk
    FOREIGN KEY (substrate_id)
    REFERENCES brain.substrate_states(id)
    ON DELETE CASCADE,
  CONSTRAINT artifact_manifests_migration_id_fk
    FOREIGN KEY (migration_id)
    REFERENCES brain.substrate_migrations(id)
    ON DELETE SET NULL,
  CONSTRAINT brain_artifact_manifests_kind_allowed
    CHECK (manifest_kind IN (
      'source_artifact',
      'ingestion_manifest',
      'migration_snapshot',
      'vault_projection',
      'export'
    )),
  CONSTRAINT brain_artifact_manifests_tier_allowed
    CHECK (storage_tier IN ('default', 'production')),
  CONSTRAINT brain_artifact_manifests_status_allowed
    CHECK (status IN ('active', 'superseded', 'deleted', 'failed')),
  CONSTRAINT brain_artifact_manifests_object_nonneg
    CHECK (object_count >= 0),
  CONSTRAINT brain_artifact_manifests_source_nonneg
    CHECK (source_count >= 0),
  CONSTRAINT brain_artifact_manifests_vector_positive
    CHECK (vector_dimension IS NULL OR vector_dimension > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS brain_artifact_manifests_manifest_uri_uidx
  ON brain.artifact_manifests (manifest_uri);

CREATE INDEX IF NOT EXISTS brain_artifact_manifests_tenant_kind_idx
  ON brain.artifact_manifests (tenant_id, manifest_kind);

CREATE INDEX IF NOT EXISTS brain_artifact_manifests_substrate_kind_idx
  ON brain.artifact_manifests (substrate_id, manifest_kind);

CREATE INDEX IF NOT EXISTS brain_artifact_manifests_migration_idx
  ON brain.artifact_manifests (migration_id);

CREATE INDEX IF NOT EXISTS brain_artifact_manifests_source_idx
  ON brain.artifact_manifests (tenant_id, source_family, source_id_hash);

SELECT pg_advisory_unlock(hashtext('migration:0166_company_brain_substrate_contract'));
