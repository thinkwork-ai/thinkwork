-- Purpose: qualify Knowledge Graph source-scope trigger queries after source-declared fallback inserts relationships.
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0147_knowledge_graph_scope_trigger_qualification.sql
-- creates-function: public.enforce_knowledge_graph_relationship_scope
-- creates-function: public.enforce_knowledge_graph_evidence_scope

\set ON_ERROR_STOP on

BEGIN;

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
  source_entity_kind text;
  source_entity_ref text;
  target_tenant uuid;
  target_thread uuid;
  target_run uuid;
  target_kind text;
  target_ref text;
  ontology_tenant uuid;
BEGIN
  SELECT
      r.tenant_id,
      r.thread_id,
      r.source_kind,
      r.source_ref
    INTO run_tenant, run_thread, run_source_kind, run_source_ref
  FROM public.knowledge_graph_ingest_runs AS r
  WHERE r.id = NEW.ingest_run_id;

  IF run_tenant IS NOT NULL
    AND (
      run_tenant != NEW.tenant_id
      OR run_thread IS DISTINCT FROM NEW.thread_id
      OR run_source_kind != NEW.source_kind
      OR run_source_ref != NEW.source_ref
    ) THEN
    RAISE EXCEPTION 'knowledge graph relationship run scope mismatch for run %', NEW.ingest_run_id;
  END IF;

  SELECT
      e.tenant_id,
      e.thread_id,
      e.ingest_run_id,
      e.source_kind,
      e.source_ref
    INTO source_tenant, source_thread, source_run, source_entity_kind, source_entity_ref
  FROM public.knowledge_graph_entities AS e
  WHERE e.id = NEW.source_entity_id;

  SELECT
      e.tenant_id,
      e.thread_id,
      e.ingest_run_id,
      e.source_kind,
      e.source_ref
    INTO target_tenant, target_thread, target_run, target_kind, target_ref
  FROM public.knowledge_graph_entities AS e
  WHERE e.id = NEW.target_entity_id;

  IF source_tenant IS NOT NULL
    AND (
      source_tenant != NEW.tenant_id
      OR source_thread IS DISTINCT FROM NEW.thread_id
      OR source_run != NEW.ingest_run_id
      OR source_entity_kind != NEW.source_kind
      OR source_entity_ref != NEW.source_ref
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
    SELECT rt.tenant_id INTO ontology_tenant
    FROM ontology.relationship_types AS rt
    WHERE rt.id = NEW.ontology_relationship_type_id;

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
  SELECT
      r.tenant_id,
      r.thread_id,
      r.source_kind,
      r.source_ref
    INTO run_tenant, run_thread, run_source_kind, run_source_ref
  FROM public.knowledge_graph_ingest_runs AS r
  WHERE r.id = NEW.ingest_run_id;

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
    SELECT
        e.tenant_id,
        e.thread_id,
        e.ingest_run_id,
        e.source_kind,
        e.source_ref
      INTO entity_tenant, entity_thread, entity_run, entity_kind, entity_ref
    FROM public.knowledge_graph_entities AS e
    WHERE e.id = NEW.entity_id;

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
    SELECT
        r.tenant_id,
        r.thread_id,
        r.ingest_run_id,
        r.source_kind,
        r.source_ref
      INTO relationship_tenant, relationship_thread, relationship_run, relationship_kind, relationship_ref
    FROM public.knowledge_graph_relationships AS r
    WHERE r.id = NEW.relationship_id;

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
    SELECT m.tenant_id, m.thread_id INTO message_tenant, message_thread
    FROM public.messages AS m
    WHERE m.id = NEW.message_id;

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
