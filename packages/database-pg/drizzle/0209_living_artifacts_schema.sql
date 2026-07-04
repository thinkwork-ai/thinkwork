-- Living Artifacts core schema foundation (THINK-145 U1).
-- Plan: docs/plans/2026-07-04-001-feat-living-artifacts-core-plan.md (U1, KTD2/KTD3)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0209_living_artifacts_schema.sql
--
-- Hand-rolled (NOT registered in meta/_journal.json — this repo's drizzle
-- journal is frozen at 0021 and every migration since is authored by hand).
-- Additive only: existing artifact rows keep working (head_version defaults to
-- 0, space_id stays NULL). space_id FK is ON DELETE RESTRICT — never cascade
-- into spaces.* (owned by a separate workstream).
--
-- creates-column: public.artifacts.space_id
-- creates-column: public.artifacts.head_version
-- creates-column: public.artifacts.head_write_seq
-- creates: public.idx_artifacts_space_id
-- creates: public.artifact_versions
-- creates: public.idx_artifact_versions_tenant_id
-- creates: public.idx_artifact_versions_artifact_id
-- creates: public.uq_artifact_versions_artifact_version
-- creates: public.artifact_data_bindings
-- creates: public.idx_artifact_data_bindings_tenant_id
-- creates: public.idx_artifact_data_bindings_artifact_id
-- creates: public.uq_artifact_data_bindings_element
-- creates-constraint: public.artifact_data_bindings.artifact_data_bindings_auth_context_allowed
-- creates-constraint: public.artifact_data_bindings.artifact_data_bindings_quality_allowed

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- artifacts: space linkage + version-chain head pointer + concurrency counter
-- ---------------------------------------------------------------------------

ALTER TABLE artifacts
  ADD COLUMN IF NOT EXISTS space_id uuid REFERENCES spaces(id) ON DELETE RESTRICT;

ALTER TABLE artifacts
  ADD COLUMN IF NOT EXISTS head_version integer NOT NULL DEFAULT 0;

ALTER TABLE artifacts
  ADD COLUMN IF NOT EXISTS head_write_seq integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_artifacts_space_id
  ON artifacts (tenant_id, space_id);

-- ---------------------------------------------------------------------------
-- artifact_versions: content-addressed, write-once pinned revisions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS artifact_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  artifact_id uuid NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  version integer NOT NULL,
  s3_key text NOT NULL,
  content_hash text NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_artifact_versions_tenant_id
  ON artifact_versions (tenant_id);

CREATE INDEX IF NOT EXISTS idx_artifact_versions_artifact_id
  ON artifact_versions (artifact_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_artifact_versions_artifact_version
  ON artifact_versions (artifact_id, version);

-- ---------------------------------------------------------------------------
-- artifact_data_bindings: the saved tool call behind each bound widget
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS artifact_data_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  artifact_id uuid NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  part_id text NOT NULL,
  element_id text NOT NULL,
  mcp_server_ref text NOT NULL,
  server_name text NOT NULL,
  tool_name text NOT NULL,
  frozen_args jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_shape_hash text NOT NULL,
  auth_context text NOT NULL,
  owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  quality text NOT NULL DEFAULT 'good',
  last_fetched_at timestamptz,
  last_good_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artifact_data_bindings_auth_context_allowed
    CHECK (auth_context IN ('tenant_mcp', 'per_user_oauth')),
  CONSTRAINT artifact_data_bindings_quality_allowed
    CHECK (quality IN ('good', 'stale', 'bad', 'schema_stale'))
);

CREATE INDEX IF NOT EXISTS idx_artifact_data_bindings_tenant_id
  ON artifact_data_bindings (tenant_id);

CREATE INDEX IF NOT EXISTS idx_artifact_data_bindings_artifact_id
  ON artifact_data_bindings (artifact_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_artifact_data_bindings_element
  ON artifact_data_bindings (artifact_id, part_id, element_id);

COMMIT;
