-- Purpose: add Cognee thread ingest run ledger and normalized graph snapshot tables.
-- Plan: docs/plans/2026-06-04-003-feat-cognee-thread-ingest-explorer-plan.md (U1)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0145_knowledge_graph_thread_ingest.sql
-- creates: public.knowledge_graph_ingest_runs
-- creates: public.knowledge_graph_entities
-- creates: public.knowledge_graph_relationships
-- creates: public.knowledge_graph_evidence
-- creates: public.idx_kg_ingest_runs_tenant_thread_created
-- creates: public.idx_kg_ingest_runs_tenant_status
-- creates: public.idx_kg_ingest_runs_requested_by
-- creates: public.uq_kg_ingest_runs_active_thread
-- creates: public.uq_kg_entities_run_cognee_node
-- creates: public.idx_kg_entities_tenant_thread_label
-- creates: public.idx_kg_entities_tenant_thread_type
-- creates: public.idx_kg_entities_tenant_thread_trust
-- creates: public.idx_kg_entities_label_trgm
-- creates: public.uq_kg_relationships_run_cognee_edge
-- creates: public.idx_kg_relationships_tenant_thread_source
-- creates: public.idx_kg_relationships_tenant_thread_target
-- creates: public.idx_kg_relationships_tenant_thread_type
-- creates: public.idx_kg_relationships_tenant_thread_trust
-- creates: public.idx_kg_evidence_tenant_thread_message
-- creates: public.idx_kg_evidence_entity
-- creates: public.idx_kg_evidence_relationship
-- creates-constraint: public.knowledge_graph_ingest_runs.knowledge_graph_ingest_runs_tenant_id_tenants_id_fk
-- creates-constraint: public.knowledge_graph_ingest_runs.knowledge_graph_ingest_runs_thread_id_threads_id_fk
-- creates-constraint: public.knowledge_graph_ingest_runs.knowledge_graph_ingest_runs_requested_by_user_id_users_id_fk
-- creates-constraint: public.knowledge_graph_ingest_runs.knowledge_graph_ingest_runs_status_allowed
-- creates-constraint: public.knowledge_graph_ingest_runs.knowledge_graph_ingest_runs_trigger_allowed
-- creates-constraint: public.knowledge_graph_entities.knowledge_graph_entities_tenant_id_tenants_id_fk
-- creates-constraint: public.knowledge_graph_entities.knowledge_graph_entities_thread_id_threads_id_fk
-- creates-constraint: public.knowledge_graph_entities.knowledge_graph_entities_ingest_run_id_runs_id_fk
-- creates-constraint: public.knowledge_graph_entities.knowledge_graph_entities_ontology_entity_type_id_fk
-- creates-constraint: public.knowledge_graph_entities.knowledge_graph_entities_grounding_allowed
-- creates-constraint: public.knowledge_graph_entities.knowledge_graph_entities_provenance_allowed
-- creates-constraint: public.knowledge_graph_relationships.knowledge_graph_relationships_tenant_id_tenants_id_fk
-- creates-constraint: public.knowledge_graph_relationships.knowledge_graph_relationships_thread_id_threads_id_fk
-- creates-constraint: public.knowledge_graph_relationships.knowledge_graph_relationships_ingest_run_id_runs_id_fk
-- creates-constraint: public.knowledge_graph_relationships.knowledge_graph_relationships_source_entity_id_entities_id_fk
-- creates-constraint: public.knowledge_graph_relationships.knowledge_graph_relationships_target_entity_id_entities_id_fk
-- creates-constraint: public.knowledge_graph_relationships.knowledge_graph_relationships_ontology_relationship_type_id_fk
-- creates-constraint: public.knowledge_graph_relationships.knowledge_graph_relationships_grounding_allowed
-- creates-constraint: public.knowledge_graph_relationships.knowledge_graph_relationships_provenance_allowed
-- creates-constraint: public.knowledge_graph_evidence.knowledge_graph_evidence_tenant_id_tenants_id_fk
-- creates-constraint: public.knowledge_graph_evidence.knowledge_graph_evidence_thread_id_threads_id_fk
-- creates-constraint: public.knowledge_graph_evidence.knowledge_graph_evidence_ingest_run_id_runs_id_fk
-- creates-constraint: public.knowledge_graph_evidence.knowledge_graph_evidence_entity_id_entities_id_fk
-- creates-constraint: public.knowledge_graph_evidence.knowledge_graph_evidence_relationship_id_relationships_id_fk
-- creates-constraint: public.knowledge_graph_evidence.knowledge_graph_evidence_message_id_messages_id_fk
-- creates-constraint: public.knowledge_graph_evidence.knowledge_graph_evidence_source_kind_allowed
-- creates-constraint: public.knowledge_graph_evidence.knowledge_graph_evidence_subject_required
-- creates-function: public.enforce_knowledge_graph_ingest_run_scope
-- creates-function: public.enforce_knowledge_graph_entity_scope
-- creates-function: public.enforce_knowledge_graph_relationship_scope
-- creates-function: public.enforce_knowledge_graph_evidence_scope
-- creates-trigger: public.knowledge_graph_ingest_runs.knowledge_graph_ingest_runs_scope_guard
-- creates-trigger: public.knowledge_graph_entities.knowledge_graph_entities_scope_guard
-- creates-trigger: public.knowledge_graph_relationships.knowledge_graph_relationships_scope_guard
-- creates-trigger: public.knowledge_graph_evidence.knowledge_graph_evidence_scope_guard

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS public.knowledge_graph_ingest_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  requested_by_user_id uuid,
  status text NOT NULL DEFAULT 'queued',
  trigger text NOT NULL DEFAULT 'manual',
  cognee_dataset_name text NOT NULL,
  cognee_dataset_id text,
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms integer,
  error text,
  entity_count integer NOT NULL DEFAULT 0,
  relationship_count integer NOT NULL DEFAULT 0,
  evidence_count integer NOT NULL DEFAULT 0,
  diagnostic_count integer NOT NULL DEFAULT 0,
  message_count integer NOT NULL DEFAULT 0,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_graph_ingest_runs_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT knowledge_graph_ingest_runs_thread_id_threads_id_fk
    FOREIGN KEY (thread_id)
    REFERENCES public.threads(id)
    ON DELETE CASCADE,
  CONSTRAINT knowledge_graph_ingest_runs_requested_by_user_id_users_id_fk
    FOREIGN KEY (requested_by_user_id)
    REFERENCES public.users(id)
    ON DELETE SET NULL,
  CONSTRAINT knowledge_graph_ingest_runs_status_allowed
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'canceled', 'stale_noop')),
  CONSTRAINT knowledge_graph_ingest_runs_trigger_allowed
    CHECK (trigger IN ('manual'))
);

CREATE INDEX IF NOT EXISTS idx_kg_ingest_runs_tenant_thread_created
  ON public.knowledge_graph_ingest_runs (tenant_id, thread_id, created_at);

CREATE INDEX IF NOT EXISTS idx_kg_ingest_runs_tenant_status
  ON public.knowledge_graph_ingest_runs (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_kg_ingest_runs_requested_by
  ON public.knowledge_graph_ingest_runs (tenant_id, requested_by_user_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_kg_ingest_runs_active_thread
  ON public.knowledge_graph_ingest_runs (tenant_id, thread_id)
  WHERE status IN ('queued', 'running');

CREATE TABLE IF NOT EXISTS public.knowledge_graph_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  ingest_run_id uuid NOT NULL,
  cognee_node_id text NOT NULL,
  label text NOT NULL,
  normalized_label text NOT NULL,
  type_label text,
  ontology_entity_type_id uuid,
  ontology_type_slug text,
  grounding_status text NOT NULL DEFAULT 'unknown',
  provenance_status text NOT NULL DEFAULT 'missing',
  summary text,
  aliases text[] NOT NULL DEFAULT ARRAY[]::text[],
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb,
  relationship_count integer NOT NULL DEFAULT 0,
  evidence_count integer NOT NULL DEFAULT 0,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_graph_entities_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT knowledge_graph_entities_thread_id_threads_id_fk
    FOREIGN KEY (thread_id)
    REFERENCES public.threads(id)
    ON DELETE CASCADE,
  CONSTRAINT knowledge_graph_entities_ingest_run_id_runs_id_fk
    FOREIGN KEY (ingest_run_id)
    REFERENCES public.knowledge_graph_ingest_runs(id)
    ON DELETE CASCADE,
  CONSTRAINT knowledge_graph_entities_ontology_entity_type_id_fk
    FOREIGN KEY (ontology_entity_type_id)
    REFERENCES ontology.entity_types(id)
    ON DELETE SET NULL,
  CONSTRAINT knowledge_graph_entities_grounding_allowed
    CHECK (grounding_status IN ('grounded', 'unapproved_type', 'ungrounded', 'conflict', 'unknown')),
  CONSTRAINT knowledge_graph_entities_provenance_allowed
    CHECK (provenance_status IN ('strong', 'weak', 'missing'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_kg_entities_run_cognee_node
  ON public.knowledge_graph_entities (ingest_run_id, cognee_node_id);

CREATE INDEX IF NOT EXISTS idx_kg_entities_tenant_thread_label
  ON public.knowledge_graph_entities (tenant_id, thread_id, normalized_label);

CREATE INDEX IF NOT EXISTS idx_kg_entities_tenant_thread_type
  ON public.knowledge_graph_entities (tenant_id, thread_id, ontology_type_slug);

CREATE INDEX IF NOT EXISTS idx_kg_entities_tenant_thread_trust
  ON public.knowledge_graph_entities (
    tenant_id,
    thread_id,
    grounding_status,
    provenance_status
  );

CREATE INDEX IF NOT EXISTS idx_kg_entities_label_trgm
  ON public.knowledge_graph_entities USING gin (normalized_label gin_trgm_ops);

CREATE TABLE IF NOT EXISTS public.knowledge_graph_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  ingest_run_id uuid NOT NULL,
  cognee_edge_id text,
  source_entity_id uuid NOT NULL,
  target_entity_id uuid NOT NULL,
  label text NOT NULL,
  ontology_relationship_type_id uuid,
  ontology_type_slug text,
  grounding_status text NOT NULL DEFAULT 'unknown',
  provenance_status text NOT NULL DEFAULT 'missing',
  confidence numeric(5, 4),
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_count integer NOT NULL DEFAULT 0,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_graph_relationships_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT knowledge_graph_relationships_thread_id_threads_id_fk
    FOREIGN KEY (thread_id)
    REFERENCES public.threads(id)
    ON DELETE CASCADE,
  CONSTRAINT knowledge_graph_relationships_ingest_run_id_runs_id_fk
    FOREIGN KEY (ingest_run_id)
    REFERENCES public.knowledge_graph_ingest_runs(id)
    ON DELETE CASCADE,
  CONSTRAINT knowledge_graph_relationships_source_entity_id_entities_id_fk
    FOREIGN KEY (source_entity_id)
    REFERENCES public.knowledge_graph_entities(id)
    ON DELETE CASCADE,
  CONSTRAINT knowledge_graph_relationships_target_entity_id_entities_id_fk
    FOREIGN KEY (target_entity_id)
    REFERENCES public.knowledge_graph_entities(id)
    ON DELETE CASCADE,
  CONSTRAINT knowledge_graph_relationships_ontology_relationship_type_id_fk
    FOREIGN KEY (ontology_relationship_type_id)
    REFERENCES ontology.relationship_types(id)
    ON DELETE SET NULL,
  CONSTRAINT knowledge_graph_relationships_grounding_allowed
    CHECK (grounding_status IN ('grounded', 'unapproved_type', 'ungrounded', 'conflict', 'unknown')),
  CONSTRAINT knowledge_graph_relationships_provenance_allowed
    CHECK (provenance_status IN ('strong', 'weak', 'missing'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_kg_relationships_run_cognee_edge
  ON public.knowledge_graph_relationships (ingest_run_id, cognee_edge_id)
  WHERE cognee_edge_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kg_relationships_tenant_thread_source
  ON public.knowledge_graph_relationships (tenant_id, thread_id, source_entity_id);

CREATE INDEX IF NOT EXISTS idx_kg_relationships_tenant_thread_target
  ON public.knowledge_graph_relationships (tenant_id, thread_id, target_entity_id);

CREATE INDEX IF NOT EXISTS idx_kg_relationships_tenant_thread_type
  ON public.knowledge_graph_relationships (tenant_id, thread_id, ontology_type_slug);

CREATE INDEX IF NOT EXISTS idx_kg_relationships_tenant_thread_trust
  ON public.knowledge_graph_relationships (
    tenant_id,
    thread_id,
    grounding_status,
    provenance_status
  );

CREATE TABLE IF NOT EXISTS public.knowledge_graph_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  ingest_run_id uuid NOT NULL,
  entity_id uuid,
  relationship_id uuid,
  message_id uuid,
  message_role text,
  message_created_at timestamptz,
  speaker_label text,
  snippet text NOT NULL,
  char_start integer,
  char_end integer,
  source_kind text NOT NULL DEFAULT 'thread_message',
  source_ref text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_graph_evidence_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT knowledge_graph_evidence_thread_id_threads_id_fk
    FOREIGN KEY (thread_id)
    REFERENCES public.threads(id)
    ON DELETE CASCADE,
  CONSTRAINT knowledge_graph_evidence_ingest_run_id_runs_id_fk
    FOREIGN KEY (ingest_run_id)
    REFERENCES public.knowledge_graph_ingest_runs(id)
    ON DELETE CASCADE,
  CONSTRAINT knowledge_graph_evidence_entity_id_entities_id_fk
    FOREIGN KEY (entity_id)
    REFERENCES public.knowledge_graph_entities(id)
    ON DELETE CASCADE,
  CONSTRAINT knowledge_graph_evidence_relationship_id_relationships_id_fk
    FOREIGN KEY (relationship_id)
    REFERENCES public.knowledge_graph_relationships(id)
    ON DELETE CASCADE,
  CONSTRAINT knowledge_graph_evidence_message_id_messages_id_fk
    FOREIGN KEY (message_id)
    REFERENCES public.messages(id)
    ON DELETE SET NULL,
  CONSTRAINT knowledge_graph_evidence_source_kind_allowed
    CHECK (source_kind IN ('thread_message', 'cognee_payload', 'normalizer')),
  CONSTRAINT knowledge_graph_evidence_subject_required
    CHECK (entity_id IS NOT NULL OR relationship_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_kg_evidence_tenant_thread_message
  ON public.knowledge_graph_evidence (tenant_id, thread_id, message_id);

CREATE INDEX IF NOT EXISTS idx_kg_evidence_entity
  ON public.knowledge_graph_evidence (entity_id);

CREATE INDEX IF NOT EXISTS idx_kg_evidence_relationship
  ON public.knowledge_graph_evidence (relationship_id);

CREATE OR REPLACE FUNCTION public.enforce_knowledge_graph_ingest_run_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  thread_tenant uuid;
BEGIN
  SELECT tenant_id INTO thread_tenant
  FROM public.threads
  WHERE id = NEW.thread_id;

  IF thread_tenant IS NOT NULL AND thread_tenant != NEW.tenant_id THEN
    RAISE EXCEPTION 'knowledge graph ingest run tenant mismatch for thread %', NEW.thread_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS knowledge_graph_ingest_runs_scope_guard
  ON public.knowledge_graph_ingest_runs;
CREATE TRIGGER knowledge_graph_ingest_runs_scope_guard
  BEFORE INSERT OR UPDATE ON public.knowledge_graph_ingest_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_knowledge_graph_ingest_run_scope();

CREATE OR REPLACE FUNCTION public.enforce_knowledge_graph_entity_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  run_tenant uuid;
  run_thread uuid;
  ontology_tenant uuid;
BEGIN
  SELECT tenant_id, thread_id INTO run_tenant, run_thread
  FROM public.knowledge_graph_ingest_runs
  WHERE id = NEW.ingest_run_id;

  IF run_tenant IS NOT NULL AND (run_tenant != NEW.tenant_id OR run_thread != NEW.thread_id) THEN
    RAISE EXCEPTION 'knowledge graph entity run scope mismatch for run %', NEW.ingest_run_id;
  END IF;

  IF NEW.ontology_entity_type_id IS NOT NULL THEN
    SELECT tenant_id INTO ontology_tenant
    FROM ontology.entity_types
    WHERE id = NEW.ontology_entity_type_id;

    IF ontology_tenant IS NOT NULL AND ontology_tenant != NEW.tenant_id THEN
      RAISE EXCEPTION 'knowledge graph entity ontology tenant mismatch for entity type %', NEW.ontology_entity_type_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS knowledge_graph_entities_scope_guard
  ON public.knowledge_graph_entities;
CREATE TRIGGER knowledge_graph_entities_scope_guard
  BEFORE INSERT OR UPDATE ON public.knowledge_graph_entities
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_knowledge_graph_entity_scope();

CREATE OR REPLACE FUNCTION public.enforce_knowledge_graph_relationship_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  run_tenant uuid;
  run_thread uuid;
  source_tenant uuid;
  source_thread uuid;
  source_run uuid;
  target_tenant uuid;
  target_thread uuid;
  target_run uuid;
  ontology_tenant uuid;
BEGIN
  SELECT tenant_id, thread_id INTO run_tenant, run_thread
  FROM public.knowledge_graph_ingest_runs
  WHERE id = NEW.ingest_run_id;

  IF run_tenant IS NOT NULL AND (run_tenant != NEW.tenant_id OR run_thread != NEW.thread_id) THEN
    RAISE EXCEPTION 'knowledge graph relationship run scope mismatch for run %', NEW.ingest_run_id;
  END IF;

  SELECT tenant_id, thread_id, ingest_run_id INTO source_tenant, source_thread, source_run
  FROM public.knowledge_graph_entities
  WHERE id = NEW.source_entity_id;

  SELECT tenant_id, thread_id, ingest_run_id INTO target_tenant, target_thread, target_run
  FROM public.knowledge_graph_entities
  WHERE id = NEW.target_entity_id;

  IF source_tenant IS NOT NULL
    AND (source_tenant != NEW.tenant_id OR source_thread != NEW.thread_id OR source_run != NEW.ingest_run_id) THEN
    RAISE EXCEPTION 'knowledge graph relationship source scope mismatch for entity %', NEW.source_entity_id;
  END IF;

  IF target_tenant IS NOT NULL
    AND (target_tenant != NEW.tenant_id OR target_thread != NEW.thread_id OR target_run != NEW.ingest_run_id) THEN
    RAISE EXCEPTION 'knowledge graph relationship target scope mismatch for entity %', NEW.target_entity_id;
  END IF;

  IF NEW.ontology_relationship_type_id IS NOT NULL THEN
    SELECT tenant_id INTO ontology_tenant
    FROM ontology.relationship_types
    WHERE id = NEW.ontology_relationship_type_id;

    IF ontology_tenant IS NOT NULL AND ontology_tenant != NEW.tenant_id THEN
      RAISE EXCEPTION 'knowledge graph relationship ontology tenant mismatch for relationship type %', NEW.ontology_relationship_type_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS knowledge_graph_relationships_scope_guard
  ON public.knowledge_graph_relationships;
CREATE TRIGGER knowledge_graph_relationships_scope_guard
  BEFORE INSERT OR UPDATE ON public.knowledge_graph_relationships
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_knowledge_graph_relationship_scope();

CREATE OR REPLACE FUNCTION public.enforce_knowledge_graph_evidence_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  run_tenant uuid;
  run_thread uuid;
  entity_tenant uuid;
  entity_thread uuid;
  entity_run uuid;
  relationship_tenant uuid;
  relationship_thread uuid;
  relationship_run uuid;
  message_tenant uuid;
  message_thread uuid;
BEGIN
  SELECT tenant_id, thread_id INTO run_tenant, run_thread
  FROM public.knowledge_graph_ingest_runs
  WHERE id = NEW.ingest_run_id;

  IF run_tenant IS NOT NULL AND (run_tenant != NEW.tenant_id OR run_thread != NEW.thread_id) THEN
    RAISE EXCEPTION 'knowledge graph evidence run scope mismatch for run %', NEW.ingest_run_id;
  END IF;

  IF NEW.entity_id IS NOT NULL THEN
    SELECT tenant_id, thread_id, ingest_run_id INTO entity_tenant, entity_thread, entity_run
    FROM public.knowledge_graph_entities
    WHERE id = NEW.entity_id;

    IF entity_tenant IS NOT NULL
      AND (entity_tenant != NEW.tenant_id OR entity_thread != NEW.thread_id OR entity_run != NEW.ingest_run_id) THEN
      RAISE EXCEPTION 'knowledge graph evidence entity scope mismatch for entity %', NEW.entity_id;
    END IF;
  END IF;

  IF NEW.relationship_id IS NOT NULL THEN
    SELECT tenant_id, thread_id, ingest_run_id INTO relationship_tenant, relationship_thread, relationship_run
    FROM public.knowledge_graph_relationships
    WHERE id = NEW.relationship_id;

    IF relationship_tenant IS NOT NULL
      AND (
        relationship_tenant != NEW.tenant_id
        OR relationship_thread != NEW.thread_id
        OR relationship_run != NEW.ingest_run_id
      ) THEN
      RAISE EXCEPTION 'knowledge graph evidence relationship scope mismatch for relationship %', NEW.relationship_id;
    END IF;
  END IF;

  IF NEW.message_id IS NOT NULL THEN
    SELECT tenant_id, thread_id INTO message_tenant, message_thread
    FROM public.messages
    WHERE id = NEW.message_id;

    IF message_tenant IS NOT NULL AND (message_tenant != NEW.tenant_id OR message_thread != NEW.thread_id) THEN
      RAISE EXCEPTION 'knowledge graph evidence message scope mismatch for message %', NEW.message_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS knowledge_graph_evidence_scope_guard
  ON public.knowledge_graph_evidence;
CREATE TRIGGER knowledge_graph_evidence_scope_guard
  BEFORE INSERT OR UPDATE ON public.knowledge_graph_evidence
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_knowledge_graph_evidence_scope();

COMMIT;
