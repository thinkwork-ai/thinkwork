-- THINK-193 U4: canonical entity identity.
-- Contents:
--   * identity.* schema (greenfield pgSchema per the feature-schema
--     extraction pattern — no compat views needed for new tables):
--       - identity.canonical_entities — stable instance registry with
--         merged-redirect invariant CHECK.
--       - identity.entity_source_mappings — exact mapping wins; unique per
--         (tenant, source_system, namespace, external_id).
--       - identity.entity_identity_claims — natural-key evidence; plain
--         lookup index (per-rule uniqueness enforced in the matcher).
--       - identity.entity_resolution_cases — operator ambiguity queue;
--         partial unique coalesces open cases by signature.
--       - identity.entity_resolution_events — append-only audit (no split).
--   * knowledge_graph_entities.canonical_entity_id + resolution_state.
--   * wiki.pages.canonical_entity_id + partial unique for tenant Entity pages.
--   * ontology.entity_types.identity_rules + identity_rules_version.
--   * memory_claims.canonical_subject_id FK (column landed in 0234).
--
-- Hand-rolled (drizzle meta journal is not in use for this change);
-- apply with: psql "$DATABASE_URL" -f drizzle/0239_canonical_entity_identity.sql
-- creates: identity.canonical_entities
-- creates: identity.entity_source_mappings
-- creates: identity.entity_identity_claims
-- creates: identity.entity_resolution_cases
-- creates: identity.entity_resolution_events
-- creates: identity.uq_entity_source_mappings_source_identity
-- creates: identity.uq_entity_resolution_cases_open_signature
-- creates-column: public.knowledge_graph_entities.canonical_entity_id
-- creates-column: public.knowledge_graph_entities.resolution_state
-- creates-column: wiki.pages.canonical_entity_id
-- creates-column: ontology.entity_types.identity_rules
-- creates-column: ontology.entity_types.identity_rules_version
-- creates: public.idx_kg_entities_tenant_canonical
-- creates: wiki.uq_pages_tenant_canonical_entity
-- creates-constraint: public.knowledge_graph_entities.knowledge_graph_entities_resolution_state_allowed
-- creates-constraint: public.memory_claims.memory_claims_canonical_subject_id_fk

\set ON_ERROR_STOP on

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('canonical_entity_identity_0239'));

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE SCHEMA IF NOT EXISTS identity;
COMMENT ON SCHEMA identity IS
  'Canonical entity instance registry (THINK-193 U4): mappings, natural-key claims, and operator resolution queue.';

-- ---------------------------------------------------------------------------
-- identity.canonical_entities
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS identity.canonical_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entity_type_slug text NOT NULL,
  display_name text NOT NULL,
  normalized_name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  merged_into_id uuid REFERENCES identity.canonical_entities(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT canonical_entities_status_allowed
    CHECK (status IN ('active','merged','archived')),
  CONSTRAINT canonical_entities_merged_redirect_required
    CHECK ((status = 'merged') = (merged_into_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_canonical_entities_tenant_status
  ON identity.canonical_entities (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_canonical_entities_tenant_type_name
  ON identity.canonical_entities (tenant_id, entity_type_slug, normalized_name);

-- ---------------------------------------------------------------------------
-- identity.entity_source_mappings
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS identity.entity_source_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  canonical_entity_id uuid NOT NULL
    REFERENCES identity.canonical_entities(id) ON DELETE CASCADE,
  source_system text NOT NULL,
  namespace text NOT NULL DEFAULT '',
  external_id text NOT NULL,
  visibility text NOT NULL DEFAULT 'tenant',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entity_source_mappings_visibility_allowed
    CHECK (visibility IN ('tenant','private')),
  CONSTRAINT entity_source_mappings_created_by_allowed
    CHECK (created_by IN ('rule','operator','backfill'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_entity_source_mappings_source_identity
  ON identity.entity_source_mappings (tenant_id, source_system, namespace, external_id);

CREATE INDEX IF NOT EXISTS idx_entity_source_mappings_canonical
  ON identity.entity_source_mappings (canonical_entity_id);

-- ---------------------------------------------------------------------------
-- identity.entity_identity_claims
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS identity.entity_identity_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  canonical_entity_id uuid NOT NULL
    REFERENCES identity.canonical_entities(id) ON DELETE CASCADE,
  rule_slug text NOT NULL,
  rule_version integer NOT NULL DEFAULT 1,
  key_kind text NOT NULL,
  normalized_value text NOT NULL,
  value_hash text NOT NULL,
  confidence numeric(5,4),
  precedence integer NOT NULL DEFAULT 0,
  visibility text NOT NULL DEFAULT 'tenant',
  state text NOT NULL DEFAULT 'active',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entity_identity_claims_visibility_allowed
    CHECK (visibility IN ('tenant','private')),
  CONSTRAINT entity_identity_claims_state_allowed
    CHECK (state IN ('active','superseded','rejected'))
);

-- Plain lookup index: per-rule uniqueness scope is enforced by the matcher
-- against the approved rule's `unique` flag, not one global unique index.
CREATE INDEX IF NOT EXISTS idx_entity_identity_claims_lookup
  ON identity.entity_identity_claims (tenant_id, key_kind, value_hash);

CREATE INDEX IF NOT EXISTS idx_entity_identity_claims_canonical
  ON identity.entity_identity_claims (canonical_entity_id);

-- ---------------------------------------------------------------------------
-- identity.entity_resolution_cases
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS identity.entity_resolution_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  signature_hash text NOT NULL,
  entity_type_slug text NOT NULL,
  display_hint text,
  candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  conflicting_claims jsonb NOT NULL DEFAULT '[]'::jsonb,
  impact_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  item_count integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'open',
  decision text,
  decided_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_canonical_entity_id uuid
    REFERENCES identity.canonical_entities(id) ON DELETE SET NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entity_resolution_cases_status_allowed
    CHECK (status IN ('open','resolved','expired')),
  CONSTRAINT entity_resolution_cases_decision_allowed
    CHECK (decision IS NULL OR decision IN ('link','create','defer','reject','merge'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_entity_resolution_cases_open_signature
  ON identity.entity_resolution_cases (tenant_id, signature_hash)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_entity_resolution_cases_tenant_status_created
  ON identity.entity_resolution_cases (tenant_id, status, created_at);

-- ---------------------------------------------------------------------------
-- identity.entity_resolution_events — append-only audit
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS identity.entity_resolution_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  case_id uuid REFERENCES identity.entity_resolution_cases(id) ON DELETE SET NULL,
  canonical_entity_id uuid
    REFERENCES identity.canonical_entities(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entity_resolution_events_type_allowed
    CHECK (event_type IN ('create','link','defer','reject','merge'))
);

CREATE INDEX IF NOT EXISTS idx_entity_resolution_events_tenant_created
  ON identity.entity_resolution_events (tenant_id, created_at);

CREATE INDEX IF NOT EXISTS idx_entity_resolution_events_case
  ON identity.entity_resolution_events (case_id);

-- ---------------------------------------------------------------------------
-- Projection columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.knowledge_graph_entities
  ADD COLUMN IF NOT EXISTS canonical_entity_id uuid
    REFERENCES identity.canonical_entities(id) ON DELETE SET NULL;

ALTER TABLE public.knowledge_graph_entities
  ADD COLUMN IF NOT EXISTS resolution_state text NOT NULL DEFAULT 'legacy';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'knowledge_graph_entities_resolution_state_allowed'
      AND conrelid = 'public.knowledge_graph_entities'::regclass
  ) THEN
    ALTER TABLE public.knowledge_graph_entities
      ADD CONSTRAINT knowledge_graph_entities_resolution_state_allowed
      CHECK (resolution_state IN ('resolved','deferred','private','legacy'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_kg_entities_tenant_canonical
  ON public.knowledge_graph_entities (tenant_id, canonical_entity_id)
  WHERE canonical_entity_id IS NOT NULL;

ALTER TABLE wiki.pages
  ADD COLUMN IF NOT EXISTS canonical_entity_id uuid
    REFERENCES identity.canonical_entities(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pages_tenant_canonical_entity
  ON wiki.pages (tenant_id, canonical_entity_id)
  WHERE owner_id IS NULL AND canonical_entity_id IS NOT NULL AND type = 'entity';

ALTER TABLE ontology.entity_types
  ADD COLUMN IF NOT EXISTS identity_rules jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE ontology.entity_types
  ADD COLUMN IF NOT EXISTS identity_rules_version integer NOT NULL DEFAULT 0;

-- memory_claims.canonical_subject_id landed as a bare uuid in 0234; the
-- identity registry now exists, so wire the FK.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'memory_claims_canonical_subject_id_fk'
      AND conrelid = 'public.memory_claims'::regclass
  ) THEN
    ALTER TABLE public.memory_claims
      ADD CONSTRAINT memory_claims_canonical_subject_id_fk
      FOREIGN KEY (canonical_subject_id)
      REFERENCES identity.canonical_entities(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMIT;
