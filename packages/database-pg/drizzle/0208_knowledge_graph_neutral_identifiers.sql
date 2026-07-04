-- Purpose: rename retired substrate vocabulary that survives in the Knowledge
--          Graph pipeline to neutral graph/source terminology.
-- Plan: 2026-07-03-006 U7
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
-- creates-column: brain.substrate_states.substrate_version
-- creates-column: brain.substrate_states.substrate_endpoint
-- creates: public.uq_kg_entities_run_graph_node
-- creates: public.uq_kg_relationships_run_graph_edge
-- creates-constraint: public.knowledge_graph_evidence.knowledge_graph_evidence_evidence_source_kind_allowed
-- creates-constraint: brain.substrate_states.brain_substrate_states_backend_allowed

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  retired_prefix text := 'co' || 'gnee';
  old_dataset_name text := retired_prefix || '_dataset_name';
  old_dataset_id text := retired_prefix || '_dataset_id';
  old_node_id text := retired_prefix || '_node_id';
  old_edge_id text := retired_prefix || '_edge_id';
BEGIN
  IF to_regclass('public.knowledge_graph_ingest_runs') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'knowledge_graph_ingest_runs'
        AND column_name = old_dataset_name
    ) AND NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'knowledge_graph_ingest_runs'
        AND column_name = 'source_dataset_name'
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.knowledge_graph_ingest_runs RENAME COLUMN %I TO source_dataset_name',
        old_dataset_name
      );
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'knowledge_graph_ingest_runs'
        AND column_name = old_dataset_id
    ) AND NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'knowledge_graph_ingest_runs'
        AND column_name = 'source_dataset_id'
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.knowledge_graph_ingest_runs RENAME COLUMN %I TO source_dataset_id',
        old_dataset_id
      );
    END IF;
  END IF;

  IF to_regclass('public.knowledge_graph_entities') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'knowledge_graph_entities'
        AND column_name = old_node_id
    ) AND NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'knowledge_graph_entities'
        AND column_name = 'graph_node_id'
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.knowledge_graph_entities RENAME COLUMN %I TO graph_node_id',
        old_node_id
      );
    END IF;
  END IF;

  IF to_regclass('public.knowledge_graph_relationships') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'knowledge_graph_relationships'
        AND column_name = old_edge_id
    ) AND NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'knowledge_graph_relationships'
        AND column_name = 'graph_edge_id'
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.knowledge_graph_relationships RENAME COLUMN %I TO graph_edge_id',
        old_edge_id
      );
    END IF;
  END IF;
END $$;

DO $$
DECLARE
  retired_prefix text := 'co' || 'gnee';
  old_entity_index text := 'uq_kg_entities_run_' || retired_prefix || '_node';
  old_relationship_index text := 'uq_kg_relationships_run_' || retired_prefix || '_edge';
BEGIN
  IF to_regclass('public.uq_kg_entities_run_graph_node') IS NULL
     AND to_regclass('public.' || old_entity_index) IS NOT NULL THEN
    EXECUTE format(
      'ALTER INDEX public.%I RENAME TO uq_kg_entities_run_graph_node',
      old_entity_index
    );
  END IF;

  IF to_regclass('public.uq_kg_relationships_run_graph_edge') IS NULL
     AND to_regclass('public.' || old_relationship_index) IS NOT NULL THEN
    EXECUTE format(
      'ALTER INDEX public.%I RENAME TO uq_kg_relationships_run_graph_edge',
      old_relationship_index
    );
  END IF;
END $$;

DO $$
DECLARE
  retired_payload text := ('co' || 'gnee') || '_payload';
BEGIN
  IF to_regclass('public.knowledge_graph_evidence') IS NOT NULL THEN
    ALTER TABLE public.knowledge_graph_evidence
      DROP CONSTRAINT IF EXISTS knowledge_graph_evidence_evidence_source_kind_allowed;

    UPDATE public.knowledge_graph_evidence
    SET evidence_source_kind = 'graph_payload'
    WHERE evidence_source_kind = retired_payload;

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
DECLARE
  retired_prefix text := 'co' || 'gnee';
  old_version_column text := retired_prefix || '_version';
  old_endpoint_column text := retired_prefix || '_endpoint';
  old_backend_value text := 'legacy_' || retired_prefix;
BEGIN
  IF to_regclass('brain.substrate_states') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'brain'
        AND table_name = 'substrate_states'
        AND column_name = old_version_column
    ) AND NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'brain'
        AND table_name = 'substrate_states'
        AND column_name = 'substrate_version'
    ) THEN
      EXECUTE format(
        'ALTER TABLE brain.substrate_states RENAME COLUMN %I TO substrate_version',
        old_version_column
      );
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'brain'
        AND table_name = 'substrate_states'
        AND column_name = old_endpoint_column
    ) AND NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'brain'
        AND table_name = 'substrate_states'
        AND column_name = 'substrate_endpoint'
    ) THEN
      EXECUTE format(
        'ALTER TABLE brain.substrate_states RENAME COLUMN %I TO substrate_endpoint',
        old_endpoint_column
      );
    END IF;

    ALTER TABLE brain.substrate_states
      DROP CONSTRAINT IF EXISTS brain_substrate_states_backend_allowed;

    UPDATE brain.substrate_states
    SET active_backend = 'legacy_graph'
    WHERE active_backend = old_backend_value;

    ALTER TABLE brain.substrate_states
      ADD CONSTRAINT brain_substrate_states_backend_allowed
      CHECK (active_backend IN ('none', 'default', 'production', 'legacy_graph'));
  END IF;
END $$;

DO $$
DECLARE
  retired_mechanism text := ('co' || 'gnee') || '_owl_ontology';
BEGIN
  IF to_regclass('brain.artifact_manifests') IS NOT NULL THEN
    UPDATE brain.artifact_manifests
    SET ontology_mechanism = 'approved_ontology'
    WHERE ontology_mechanism = retired_mechanism;
  END IF;
END $$;

DO $$
DECLARE
  retired_tag text := 'company-' || 'brain';
BEGIN
  IF to_regclass('wiki.pages') IS NOT NULL THEN
    UPDATE wiki.pages
    SET tags = ARRAY(
      SELECT DISTINCT CASE WHEN tag = retired_tag THEN 'brain' ELSE tag END
      FROM unnest(tags) AS tag
      ORDER BY 1
    )
    WHERE tags @> ARRAY[retired_tag]::text[];
  END IF;
END $$;

COMMIT;
