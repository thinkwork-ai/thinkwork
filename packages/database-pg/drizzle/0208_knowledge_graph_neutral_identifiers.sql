-- Purpose: rename retired substrate vocabulary that survives in the Knowledge
--          Graph pipeline to neutral graph/source terminology.
-- Plan: docs/plans/2026-07-03-006-refactor-cognee-eradication-plan.md U7
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0208_knowledge_graph_neutral_identifiers.sql
--
-- Hand-rolled (NOT registered in meta/_journal.json). Idempotent for both:
--   * existing databases that still have the retired column/value names, and
--   * fresh databases whose bootstrap SQL has already been scrubbed.
--
-- creates-column: public.knowledge_graph_ingest_runs.source_dataset_name
-- creates-column: public.knowledge_graph_ingest_runs.source_dataset_id
-- creates-column: public.knowledge_graph_entities.graph_node_id
-- creates-column: public.knowledge_graph_relationships.graph_edge_id
-- creates: public.uq_kg_entities_run_graph_node
-- creates: public.uq_kg_relationships_run_graph_edge
-- creates-constraint: public.knowledge_graph_evidence.knowledge_graph_evidence_evidence_source_kind_allowed

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.knowledge_graph_ingest_runs') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'knowledge_graph_ingest_runs'
        AND column_name = 'cognee_dataset_name'
    ) AND NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'knowledge_graph_ingest_runs'
        AND column_name = 'source_dataset_name'
    ) THEN
      ALTER TABLE public.knowledge_graph_ingest_runs
        RENAME COLUMN cognee_dataset_name TO source_dataset_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'knowledge_graph_ingest_runs'
        AND column_name = 'cognee_dataset_id'
    ) AND NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'knowledge_graph_ingest_runs'
        AND column_name = 'source_dataset_id'
    ) THEN
      ALTER TABLE public.knowledge_graph_ingest_runs
        RENAME COLUMN cognee_dataset_id TO source_dataset_id;
    END IF;
  END IF;

  IF to_regclass('public.knowledge_graph_entities') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'knowledge_graph_entities'
        AND column_name = 'cognee_node_id'
    ) AND NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'knowledge_graph_entities'
        AND column_name = 'graph_node_id'
    ) THEN
      ALTER TABLE public.knowledge_graph_entities
        RENAME COLUMN cognee_node_id TO graph_node_id;
    END IF;
  END IF;

  IF to_regclass('public.knowledge_graph_relationships') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'knowledge_graph_relationships'
        AND column_name = 'cognee_edge_id'
    ) AND NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'knowledge_graph_relationships'
        AND column_name = 'graph_edge_id'
    ) THEN
      ALTER TABLE public.knowledge_graph_relationships
        RENAME COLUMN cognee_edge_id TO graph_edge_id;
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.uq_kg_entities_run_graph_node') IS NULL
     AND to_regclass('public.uq_kg_entities_run_cognee_node') IS NOT NULL THEN
    ALTER INDEX public.uq_kg_entities_run_cognee_node
      RENAME TO uq_kg_entities_run_graph_node;
  END IF;

  IF to_regclass('public.uq_kg_relationships_run_graph_edge') IS NULL
     AND to_regclass('public.uq_kg_relationships_run_cognee_edge') IS NOT NULL THEN
    ALTER INDEX public.uq_kg_relationships_run_cognee_edge
      RENAME TO uq_kg_relationships_run_graph_edge;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.knowledge_graph_evidence') IS NOT NULL THEN
    ALTER TABLE public.knowledge_graph_evidence
      DROP CONSTRAINT IF EXISTS knowledge_graph_evidence_evidence_source_kind_allowed;

    UPDATE public.knowledge_graph_evidence
    SET evidence_source_kind = 'graph_payload'
    WHERE evidence_source_kind = 'cognee_payload';

    ALTER TABLE public.knowledge_graph_evidence
      ADD CONSTRAINT knowledge_graph_evidence_evidence_source_kind_allowed
      CHECK (evidence_source_kind IN (
        'thread_message',
        'wiki_page',
        'wiki_section',
        'brain_page',
        'brain_section',
        'hindsight_observation',
        'graph_payload',
        'normalizer'
      ));
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('brain.artifact_manifests') IS NOT NULL THEN
    UPDATE brain.artifact_manifests
    SET ontology_mechanism = 'approved_ontology'
    WHERE ontology_mechanism = 'cognee_owl_ontology';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('wiki.pages') IS NOT NULL THEN
    UPDATE wiki.pages
    SET tags = ARRAY(
      SELECT DISTINCT CASE WHEN tag = 'company-brain' THEN 'brain' ELSE tag END
      FROM unnest(tags) AS tag
      ORDER BY 1
    )
    WHERE tags @> ARRAY['company-brain']::text[];
  END IF;
END $$;

COMMIT;
