-- Purpose: extend brain.artifact_manifests with runtime provenance needed for
--   replayable Company Brain source artifacts and Knowledge Graph ingest links.
-- Plan: docs/plans/2026-06-14-001-feat-company-brain-artifact-manifests-plan.md U2
-- Apply manually (no CI migration runner):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0167_company_brain_artifact_manifest_runtime.sql
-- Pre-flight:
--   SELECT to_regclass('brain.artifact_manifests');
--   SELECT to_regclass('public.knowledge_graph_ingest_runs');
-- creates-column: brain.artifact_manifests.ingest_run_id
-- creates-column: brain.artifact_manifests.source_kind
-- creates-column: brain.artifact_manifests.source_type
-- creates-column: brain.artifact_manifests.source_ids
-- creates-column: brain.artifact_manifests.object_version_id
-- creates-column: brain.artifact_manifests.content_type
-- creates-column: brain.artifact_manifests.content_encoding
-- creates-column: brain.artifact_manifests.byte_length
-- creates-column: brain.artifact_manifests.ontology_mechanism
-- creates-column: brain.artifact_manifests.metadata
-- creates: brain.brain_artifact_manifests_ingest_run_idx
-- creates: brain.brain_artifact_manifests_source_kind_idx
-- creates-constraint: brain.artifact_manifests.artifact_manifests_ingest_run_id_fk
-- creates-constraint: brain.artifact_manifests.brain_artifact_manifests_source_kind_allowed
-- creates-constraint: brain.artifact_manifests.brain_artifact_manifests_byte_nonneg

\set ON_ERROR_STOP on

SET lock_timeout = '5s';
SET statement_timeout = '15min';

SELECT pg_advisory_lock(hashtext('migration:0167_company_brain_artifact_manifest_runtime'));

ALTER TABLE brain.artifact_manifests
  ADD COLUMN IF NOT EXISTS ingest_run_id uuid,
  ADD COLUMN IF NOT EXISTS source_kind text,
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS source_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS object_version_id text,
  ADD COLUMN IF NOT EXISTS content_type text,
  ADD COLUMN IF NOT EXISTS content_encoding text,
  ADD COLUMN IF NOT EXISTS byte_length integer,
  ADD COLUMN IF NOT EXISTS ontology_mechanism text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  ALTER TABLE brain.artifact_manifests
    ADD CONSTRAINT artifact_manifests_ingest_run_id_fk
    FOREIGN KEY (ingest_run_id)
    REFERENCES public.knowledge_graph_ingest_runs(id)
    ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE brain.artifact_manifests
    ADD CONSTRAINT brain_artifact_manifests_source_kind_allowed
    CHECK (
      source_kind IS NULL
      OR source_kind IN ('thread', 'wiki', 'brain', 'observations')
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE brain.artifact_manifests
    ADD CONSTRAINT brain_artifact_manifests_byte_nonneg
    CHECK (byte_length IS NULL OR byte_length >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE INDEX IF NOT EXISTS brain_artifact_manifests_ingest_run_idx
  ON brain.artifact_manifests (ingest_run_id);

CREATE INDEX IF NOT EXISTS brain_artifact_manifests_source_kind_idx
  ON brain.artifact_manifests (tenant_id, source_kind, source_id_hash);

SELECT pg_advisory_unlock(hashtext('migration:0167_company_brain_artifact_manifest_runtime'));
