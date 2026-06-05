-- Purpose: make Knowledge Graph snapshots source-aware for thread, wiki, and brain ingests.
-- Plan: docs/plans/2026-06-05-001-feat-knowledge-graph-wiki-brain-ingest-plan.md (U1)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0146_knowledge_graph_source_scope.sql
-- creates-column: public.knowledge_graph_ingest_runs.source_kind
-- creates-column: public.knowledge_graph_ingest_runs.source_ref
-- creates-column: public.knowledge_graph_ingest_runs.source_label
-- creates-column: public.knowledge_graph_entities.source_kind
-- creates-column: public.knowledge_graph_entities.source_ref
-- creates-column: public.knowledge_graph_relationships.source_kind
-- creates-column: public.knowledge_graph_relationships.source_ref
-- creates-column: public.knowledge_graph_evidence.source_kind
-- creates-column: public.knowledge_graph_evidence.source_ref
-- creates-column: public.knowledge_graph_evidence.evidence_source_kind
-- creates-column: public.knowledge_graph_evidence.evidence_source_ref
-- creates: public.idx_kg_ingest_runs_tenant_source_created
-- creates: public.uq_kg_ingest_runs_active_source
-- creates: public.idx_kg_entities_tenant_source_label
-- creates: public.idx_kg_relationships_tenant_source_type
-- creates: public.idx_kg_evidence_tenant_source
-- creates-constraint: public.knowledge_graph_ingest_runs.knowledge_graph_ingest_runs_source_kind_allowed
-- creates-constraint: public.knowledge_graph_ingest_runs.knowledge_graph_ingest_runs_thread_scope_required
-- creates-constraint: public.knowledge_graph_entities.knowledge_graph_entities_source_kind_allowed
-- creates-constraint: public.knowledge_graph_relationships.knowledge_graph_relationships_source_kind_allowed
-- creates-constraint: public.knowledge_graph_evidence.knowledge_graph_evidence_evidence_source_kind_allowed

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.knowledge_graph_ingest_runs
  ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'thread',
  ADD COLUMN IF NOT EXISTS source_ref text,
  ADD COLUMN IF NOT EXISTS source_label text;

UPDATE public.knowledge_graph_ingest_runs
SET source_ref = thread_id::text
WHERE source_ref IS NULL AND thread_id IS NOT NULL;

UPDATE public.knowledge_graph_ingest_runs
SET source_label = input->>'threadTitle'
WHERE source_label IS NULL AND input ? 'threadTitle';

ALTER TABLE public.knowledge_graph_ingest_runs
  ALTER COLUMN source_ref SET NOT NULL,
  ALTER COLUMN thread_id DROP NOT NULL;

ALTER TABLE public.knowledge_graph_entities
  ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'thread',
  ADD COLUMN IF NOT EXISTS source_ref text;

UPDATE public.knowledge_graph_entities
SET source_ref = thread_id::text
WHERE source_ref IS NULL AND thread_id IS NOT NULL;

ALTER TABLE public.knowledge_graph_entities
  ALTER COLUMN source_ref SET NOT NULL,
  ALTER COLUMN thread_id DROP NOT NULL;

ALTER TABLE public.knowledge_graph_relationships
  ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'thread',
  ADD COLUMN IF NOT EXISTS source_ref text;

UPDATE public.knowledge_graph_relationships
SET source_ref = thread_id::text
WHERE source_ref IS NULL AND thread_id IS NOT NULL;

ALTER TABLE public.knowledge_graph_relationships
  ALTER COLUMN source_ref SET NOT NULL,
  ALTER COLUMN thread_id DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'knowledge_graph_evidence'
      AND column_name = 'source_kind'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'knowledge_graph_evidence'
      AND column_name = 'evidence_source_kind'
  ) THEN
    ALTER TABLE public.knowledge_graph_evidence
      RENAME COLUMN source_kind TO evidence_source_kind;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'knowledge_graph_evidence'
      AND column_name = 'source_ref'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'knowledge_graph_evidence'
      AND column_name = 'evidence_source_ref'
  ) THEN
    ALTER TABLE public.knowledge_graph_evidence
      RENAME COLUMN source_ref TO evidence_source_ref;
  END IF;
END $$;

ALTER TABLE public.knowledge_graph_evidence
  ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'thread',
  ADD COLUMN IF NOT EXISTS source_ref text;

UPDATE public.knowledge_graph_evidence
SET source_ref = thread_id::text
WHERE source_ref IS NULL AND thread_id IS NOT NULL;

ALTER TABLE public.knowledge_graph_evidence
  ALTER COLUMN source_ref SET NOT NULL,
  ALTER COLUMN thread_id DROP NOT NULL;

DROP INDEX IF EXISTS public.uq_kg_ingest_runs_active_thread;

CREATE UNIQUE INDEX IF NOT EXISTS uq_kg_ingest_runs_active_thread
  ON public.knowledge_graph_ingest_runs (tenant_id, thread_id)
  WHERE thread_id IS NOT NULL AND status IN ('queued','running');

CREATE INDEX IF NOT EXISTS idx_kg_ingest_runs_tenant_source_created
  ON public.knowledge_graph_ingest_runs (tenant_id, source_kind, source_ref, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_kg_ingest_runs_active_source
  ON public.knowledge_graph_ingest_runs (tenant_id, source_kind, source_ref)
  WHERE status IN ('queued','running');

CREATE INDEX IF NOT EXISTS idx_kg_entities_tenant_source_label
  ON public.knowledge_graph_entities (tenant_id, source_kind, source_ref, normalized_label);

CREATE INDEX IF NOT EXISTS idx_kg_relationships_tenant_source_type
  ON public.knowledge_graph_relationships (tenant_id, source_kind, source_ref, ontology_type_slug);

CREATE INDEX IF NOT EXISTS idx_kg_evidence_tenant_source
  ON public.knowledge_graph_evidence (tenant_id, source_kind, source_ref);

ALTER TABLE public.knowledge_graph_ingest_runs
  DROP CONSTRAINT IF EXISTS knowledge_graph_ingest_runs_source_kind_allowed,
  DROP CONSTRAINT IF EXISTS knowledge_graph_ingest_runs_thread_scope_required,
  ADD CONSTRAINT knowledge_graph_ingest_runs_source_kind_allowed
    CHECK (source_kind IN ('thread','wiki','brain')),
  ADD CONSTRAINT knowledge_graph_ingest_runs_thread_scope_required
    CHECK (source_kind != 'thread' OR thread_id IS NOT NULL);

ALTER TABLE public.knowledge_graph_entities
  DROP CONSTRAINT IF EXISTS knowledge_graph_entities_source_kind_allowed,
  ADD CONSTRAINT knowledge_graph_entities_source_kind_allowed
    CHECK (source_kind IN ('thread','wiki','brain'));

ALTER TABLE public.knowledge_graph_relationships
  DROP CONSTRAINT IF EXISTS knowledge_graph_relationships_source_kind_allowed,
  ADD CONSTRAINT knowledge_graph_relationships_source_kind_allowed
    CHECK (source_kind IN ('thread','wiki','brain'));

ALTER TABLE public.knowledge_graph_evidence
  DROP CONSTRAINT IF EXISTS knowledge_graph_evidence_source_kind_allowed,
  DROP CONSTRAINT IF EXISTS knowledge_graph_evidence_evidence_source_kind_allowed,
  ADD CONSTRAINT knowledge_graph_evidence_source_kind_allowed
    CHECK (source_kind IN ('thread','wiki','brain')),
  ADD CONSTRAINT knowledge_graph_evidence_evidence_source_kind_allowed
    CHECK (evidence_source_kind IN ('thread_message','wiki_page','wiki_section','brain_page','brain_section','cognee_payload','normalizer'));

CREATE OR REPLACE FUNCTION public.enforce_knowledge_graph_ingest_run_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  thread_tenant uuid;
BEGIN
  IF NEW.source_kind = 'thread' AND NEW.thread_id IS NULL THEN
    RAISE EXCEPTION 'knowledge graph thread ingest requires thread_id';
  END IF;

  IF NEW.source_kind = 'thread' AND NEW.source_ref != NEW.thread_id::text THEN
    RAISE EXCEPTION 'knowledge graph thread ingest source_ref must match thread_id';
  END IF;

  IF NEW.thread_id IS NOT NULL THEN
    SELECT tenant_id INTO thread_tenant
    FROM public.threads
    WHERE id = NEW.thread_id;

    IF thread_tenant IS NOT NULL AND thread_tenant != NEW.tenant_id THEN
      RAISE EXCEPTION 'knowledge graph ingest run tenant mismatch for thread %', NEW.thread_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_knowledge_graph_entity_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  run_tenant uuid;
  run_thread uuid;
  run_source_kind text;
  run_source_ref text;
  ontology_tenant uuid;
BEGIN
  SELECT tenant_id, thread_id, source_kind, source_ref
    INTO run_tenant, run_thread, run_source_kind, run_source_ref
  FROM public.knowledge_graph_ingest_runs
  WHERE id = NEW.ingest_run_id;

  IF run_tenant IS NOT NULL
    AND (
      run_tenant != NEW.tenant_id
      OR run_thread IS DISTINCT FROM NEW.thread_id
      OR run_source_kind != NEW.source_kind
      OR run_source_ref != NEW.source_ref
    ) THEN
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

CREATE OR REPLACE FUNCTION public.enforce_knowledge_graph_relationship_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  run_tenant uuid;
  run_thread uuid;
  run_source_kind text;
  run_source_ref text;
  source_tenant uuid;
  source_thread uuid;
  source_run uuid;
  source_kind text;
  source_ref text;
  target_tenant uuid;
  target_thread uuid;
  target_run uuid;
  target_kind text;
  target_ref text;
  ontology_tenant uuid;
BEGIN
  SELECT tenant_id, thread_id, source_kind, source_ref
    INTO run_tenant, run_thread, run_source_kind, run_source_ref
  FROM public.knowledge_graph_ingest_runs
  WHERE id = NEW.ingest_run_id;

  IF run_tenant IS NOT NULL
    AND (
      run_tenant != NEW.tenant_id
      OR run_thread IS DISTINCT FROM NEW.thread_id
      OR run_source_kind != NEW.source_kind
      OR run_source_ref != NEW.source_ref
    ) THEN
    RAISE EXCEPTION 'knowledge graph relationship run scope mismatch for run %', NEW.ingest_run_id;
  END IF;

  SELECT tenant_id, thread_id, ingest_run_id, source_kind, source_ref
    INTO source_tenant, source_thread, source_run, source_kind, source_ref
  FROM public.knowledge_graph_entities
  WHERE id = NEW.source_entity_id;

  SELECT tenant_id, thread_id, ingest_run_id, source_kind, source_ref
    INTO target_tenant, target_thread, target_run, target_kind, target_ref
  FROM public.knowledge_graph_entities
  WHERE id = NEW.target_entity_id;

  IF source_tenant IS NOT NULL
    AND (
      source_tenant != NEW.tenant_id
      OR source_thread IS DISTINCT FROM NEW.thread_id
      OR source_run != NEW.ingest_run_id
      OR source_kind != NEW.source_kind
      OR source_ref != NEW.source_ref
    ) THEN
    RAISE EXCEPTION 'knowledge graph relationship source scope mismatch for entity %', NEW.source_entity_id;
  END IF;

  IF target_tenant IS NOT NULL
    AND (
      target_tenant != NEW.tenant_id
      OR target_thread IS DISTINCT FROM NEW.thread_id
      OR target_run != NEW.ingest_run_id
      OR target_kind != NEW.source_kind
      OR target_ref != NEW.source_ref
    ) THEN
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

CREATE OR REPLACE FUNCTION public.enforce_knowledge_graph_evidence_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  run_tenant uuid;
  run_thread uuid;
  run_source_kind text;
  run_source_ref text;
  entity_tenant uuid;
  entity_thread uuid;
  entity_run uuid;
  entity_kind text;
  entity_ref text;
  relationship_tenant uuid;
  relationship_thread uuid;
  relationship_run uuid;
  relationship_kind text;
  relationship_ref text;
  message_tenant uuid;
  message_thread uuid;
BEGIN
  SELECT tenant_id, thread_id, source_kind, source_ref
    INTO run_tenant, run_thread, run_source_kind, run_source_ref
  FROM public.knowledge_graph_ingest_runs
  WHERE id = NEW.ingest_run_id;

  IF run_tenant IS NOT NULL
    AND (
      run_tenant != NEW.tenant_id
      OR run_thread IS DISTINCT FROM NEW.thread_id
      OR run_source_kind != NEW.source_kind
      OR run_source_ref != NEW.source_ref
    ) THEN
    RAISE EXCEPTION 'knowledge graph evidence run scope mismatch for run %', NEW.ingest_run_id;
  END IF;

  IF NEW.entity_id IS NOT NULL THEN
    SELECT tenant_id, thread_id, ingest_run_id, source_kind, source_ref
      INTO entity_tenant, entity_thread, entity_run, entity_kind, entity_ref
    FROM public.knowledge_graph_entities
    WHERE id = NEW.entity_id;

    IF entity_tenant IS NOT NULL
      AND (
        entity_tenant != NEW.tenant_id
        OR entity_thread IS DISTINCT FROM NEW.thread_id
        OR entity_run != NEW.ingest_run_id
        OR entity_kind != NEW.source_kind
        OR entity_ref != NEW.source_ref
      ) THEN
      RAISE EXCEPTION 'knowledge graph evidence entity scope mismatch for entity %', NEW.entity_id;
    END IF;
  END IF;

  IF NEW.relationship_id IS NOT NULL THEN
    SELECT tenant_id, thread_id, ingest_run_id, source_kind, source_ref
      INTO relationship_tenant, relationship_thread, relationship_run, relationship_kind, relationship_ref
    FROM public.knowledge_graph_relationships
    WHERE id = NEW.relationship_id;

    IF relationship_tenant IS NOT NULL
      AND (
        relationship_tenant != NEW.tenant_id
        OR relationship_thread IS DISTINCT FROM NEW.thread_id
        OR relationship_run != NEW.ingest_run_id
        OR relationship_kind != NEW.source_kind
        OR relationship_ref != NEW.source_ref
      ) THEN
      RAISE EXCEPTION 'knowledge graph evidence relationship scope mismatch for relationship %', NEW.relationship_id;
    END IF;
  END IF;

  IF NEW.message_id IS NOT NULL THEN
    SELECT tenant_id, thread_id INTO message_tenant, message_thread
    FROM public.messages
    WHERE id = NEW.message_id;

    IF message_tenant IS NOT NULL
      AND (
        message_tenant != NEW.tenant_id
        OR message_thread IS DISTINCT FROM NEW.thread_id
      ) THEN
      RAISE EXCEPTION 'knowledge graph evidence message scope mismatch for message %', NEW.message_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
