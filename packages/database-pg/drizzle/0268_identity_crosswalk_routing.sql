-- THINK-321 U1: identity crosswalk routing vocabulary and linkage.
-- Plan: docs/plans/2026-07-19-001-feat-ontology-identity-crosswalk-agent-routing-plan.md (U1)
-- Contents:
--   * identity.entity_source_mappings — `created_by` CHECK gains 'user'
--     (in-turn confirm attribution); nullable created_by_user_id +
--     created_thread_ref audit columns.
--   * identity.entity_resolution_events — `event_type` CHECK gains
--     'revoke' and 'split' (the V1 "no split" restriction is lifted).
--   * identity.mapping_rejections — negative evidence: rejected
--     (source identity <-> canonical entity) pairings, honored by the
--     matcher (KTD-6).
--   * identity.source_system_connectors — source_system -> tenant connector
--     linkage, read fail-closed by resolve (KTD-5).
--   * identity.match_jobs — bootstrap/drift match jobs mirroring
--     ontology.suggestion_scan_jobs (KTD-7).
--   * identity.mapping_candidate_sets — in-turn confirm echo-check store:
--     written by propose, invalidated on confirm/decline/re-propose,
--     expired rows refused (KTD-2).
-- Constraint widening ships BEFORE any writer code (this unit has none).
--
-- Hand-rolled (drizzle meta journal is not in use for this change).
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0268_identity_crosswalk_routing.sql
-- creates-column: identity.entity_source_mappings.created_by_user_id
-- creates-column: identity.entity_source_mappings.created_thread_ref
-- creates-constraint: identity.entity_source_mappings.entity_source_mappings_created_by_allowed
-- creates-constraint: identity.entity_resolution_events.entity_resolution_events_type_allowed
-- creates: identity.mapping_rejections
-- creates: identity.uq_mapping_rejections_pairing
-- creates: identity.idx_mapping_rejections_tenant_canonical
-- creates-constraint: identity.mapping_rejections.mapping_rejections_created_by_allowed
-- creates: identity.source_system_connectors
-- creates-constraint: identity.source_system_connectors.source_system_connectors_connector_slug_fk
-- creates: identity.match_jobs
-- creates: identity.uq_identity_match_jobs_dedupe
-- creates: identity.idx_identity_match_jobs_tenant_status
-- creates-constraint: identity.match_jobs.match_jobs_status_allowed
-- creates: identity.mapping_candidate_sets
-- creates: identity.idx_mapping_candidate_sets_tenant_thread
-- creates-constraint: identity.mapping_candidate_sets.mapping_candidate_sets_status_allowed

\set ON_ERROR_STOP on

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('identity_crosswalk_routing_0268'));

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- identity.entity_source_mappings — user attribution vocabulary
-- ---------------------------------------------------------------------------

ALTER TABLE identity.entity_source_mappings
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid
    REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE identity.entity_source_mappings
  ADD COLUMN IF NOT EXISTS created_thread_ref text;

ALTER TABLE identity.entity_source_mappings
  DROP CONSTRAINT IF EXISTS entity_source_mappings_created_by_allowed;
ALTER TABLE identity.entity_source_mappings
  ADD CONSTRAINT entity_source_mappings_created_by_allowed
  CHECK (created_by IN ('rule','operator','backfill','user'));

-- ---------------------------------------------------------------------------
-- identity.entity_resolution_events — revoke + split event vocabulary
-- ---------------------------------------------------------------------------

ALTER TABLE identity.entity_resolution_events
  DROP CONSTRAINT IF EXISTS entity_resolution_events_type_allowed;
ALTER TABLE identity.entity_resolution_events
  ADD CONSTRAINT entity_resolution_events_type_allowed
  CHECK (event_type IN ('create','link','defer','reject','merge','revoke','split'));

-- ---------------------------------------------------------------------------
-- identity.mapping_rejections — negative evidence (KTD-6)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS identity.mapping_rejections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_system text NOT NULL,
  namespace text NOT NULL DEFAULT '',
  external_id text NOT NULL,
  canonical_entity_id uuid NOT NULL
    REFERENCES identity.canonical_entities(id) ON DELETE CASCADE,
  reason text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mapping_rejections_created_by_allowed
    CHECK (created_by IN ('user','operator','rule','system'))
);

-- One rejection row per (source identity, canonical entity) pairing.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mapping_rejections_pairing
  ON identity.mapping_rejections
    (tenant_id, source_system, namespace, external_id, canonical_entity_id);

CREATE INDEX IF NOT EXISTS idx_mapping_rejections_tenant_canonical
  ON identity.mapping_rejections (tenant_id, canonical_entity_id);

-- ---------------------------------------------------------------------------
-- identity.source_system_connectors — source_system -> connector link (KTD-5)
-- ---------------------------------------------------------------------------

-- The composite FK targets the plain unique index uq_tenant_mcp_servers_slug
-- on public.tenant_mcp_servers (tenant_id, slug) — Postgres accepts a
-- non-partial unique index as an FK target. ON UPDATE/DELETE CASCADE keeps
-- the link from dangling when a connector is renamed or removed; resolve
-- reads it fail-closed either way.
CREATE TABLE IF NOT EXISTS identity.source_system_connectors (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_system text NOT NULL,
  connector_slug text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, source_system),
  CONSTRAINT source_system_connectors_connector_slug_fk
    FOREIGN KEY (tenant_id, connector_slug)
    REFERENCES public.tenant_mcp_servers (tenant_id, slug)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- identity.match_jobs — bootstrap/drift match jobs (KTD-7)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS identity.match_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  trigger text NOT NULL DEFAULT 'manual',
  dedupe_key text,
  source_systems jsonb NOT NULL DEFAULT '[]'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  CONSTRAINT match_jobs_status_allowed
    CHECK (status IN ('pending','running','succeeded','failed'))
);

-- Insert-or-load dedupe: at most one job per live dedupe key.
CREATE UNIQUE INDEX IF NOT EXISTS uq_identity_match_jobs_dedupe
  ON identity.match_jobs (tenant_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_identity_match_jobs_tenant_status
  ON identity.match_jobs (tenant_id, status);

-- ---------------------------------------------------------------------------
-- identity.mapping_candidate_sets — confirm echo-check store (KTD-2)
-- ---------------------------------------------------------------------------

-- Lifecycle: written by propose (status='open'); invalidated on
-- confirm/decline/re-propose (confirmed/declined/superseded); expired rows
-- are refused. confirm_mapping succeeds only when the echoed candidate id
-- matches the recorded selection on an open, unexpired row for the thread.
CREATE TABLE IF NOT EXISTS identity.mapping_candidate_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  thread_ref text NOT NULL,
  source_system text NOT NULL,
  namespace text NOT NULL DEFAULT '',
  target_entity_ref jsonb,
  candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'open',
  selected_candidate_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  CONSTRAINT mapping_candidate_sets_status_allowed
    CHECK (status IN ('open','confirmed','declined','superseded','expired'))
);

CREATE INDEX IF NOT EXISTS idx_mapping_candidate_sets_tenant_thread
  ON identity.mapping_candidate_sets (tenant_id, thread_ref);

COMMIT;
