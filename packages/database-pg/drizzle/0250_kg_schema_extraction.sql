-- 0250_kg_schema_extraction.sql
--
-- Phase A of the knowledge-graph schema extraction (PR 1 of the THINK-290
-- arc). Moves the five public.knowledge_graph_* tables into the new `kg.*`
-- Postgres schema, drops the redundant `knowledge_graph_` prefix from table
-- and CHECK-constraint names, re-points the scope-guard trigger functions at
-- the new schema-qualified names, and creates compat views in public.* so
-- old bundled Lambda code keeps reading during the deploy bridge window.
--
-- Tables moved:
--   public.knowledge_graph_ingest_runs         → kg.ingest_runs
--   public.knowledge_graph_entities            → kg.entities
--   public.knowledge_graph_relationships       → kg.relationships
--   public.knowledge_graph_evidence            → kg.evidence
--   public.knowledge_graph_observation_cursors → kg.observation_cursors
--
-- Index names already use the `idx_kg_*` / `uq_kg_*` shorthand and are kept
-- verbatim; they move with their tables via SET SCHEMA. FK constraint names
-- and the `knowledge_graph_*_scope_guard` trigger names keep their original
-- prefixes — cosmetic cleanup deferred, same as the 0089/0090 precedent.
-- CHECK constraint names embed the table name in Drizzle's naming, so they
-- are renamed to the new stems to keep the Drizzle source and DB aligned.
--
-- The scope-guard trigger functions (0146/0147) query
-- public.knowledge_graph_* schema-qualified inside their plpgsql bodies.
-- Left alone they would resolve to the compat views (works during the
-- bridge) and break when the views drop, so this migration CREATE OR
-- REPLACEs the three functions that reference the moved tables with kg.*
-- qualified queries. enforce_knowledge_graph_ingest_run_scope references
-- only public.threads and is untouched.
--
-- Analyst surface: the semantic model deliberately includes public-schema
-- tables only (THINK-283), so the moved tables leave the analyst grants/RLS
-- surface, matching the wiki/ontology/brain extractions. Stale table-level
-- grants and analyst_tenant_isolation policies ride along harmlessly (the
-- app role owns the tables and bypasses RLS; analyst_reader has no USAGE on
-- kg).
--
-- Plan reference: docs/plans/2026-07-14-001-refactor-kg-schema-extraction-and-brain-cleanup-plan.md
-- Pattern doc:    docs/solutions/database-issues/feature-schema-extraction-pattern.md
--
-- Apply manually (pause the observations-ingest schedule first — see the
-- writer runbook in the PR body):
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0250_kg_schema_extraction.sql
-- Then verify:
--   bash scripts/db-migrate-manual.sh packages/database-pg/drizzle/0250_kg_schema_extraction.sql
--   psql -c "\dt kg.*"                        -- 5 tables expected
--   psql -c "\dv public.knowledge_graph_*"    -- 5 compat views expected
--   psql -c "\dt public.knowledge_graph_*"    -- 0 tables expected
--
-- Inverse runbook (rollback): drop the views, SET SCHEMA back, RENAME back,
-- restore the CHECK constraint names, and re-run the 0146/0147 function
-- bodies to restore the public.* qualification:
--   DROP VIEW IF EXISTS public.knowledge_graph_ingest_runs, ...;  -- × 5
--   ALTER TABLE kg.evidence SET SCHEMA public;
--   ALTER TABLE public.evidence RENAME TO knowledge_graph_evidence;
--   ALTER TABLE public.knowledge_graph_evidence RENAME CONSTRAINT evidence_source_kind_allowed TO knowledge_graph_evidence_source_kind_allowed;
--   ... (× 5 tables, × 14 constraints, leaf-first)
--   -- re-apply 0146 + 0147 function definitions
--   DROP SCHEMA kg;   -- last step; fails if any objects remain
--
-- Markers (consumed by scripts/db-migrate-manual.sh):
--
-- creates: kg.ingest_runs
-- creates: kg.entities
-- creates: kg.relationships
-- creates: kg.evidence
-- creates: kg.observation_cursors
-- creates-constraint: kg.ingest_runs.ingest_runs_status_allowed
-- creates-constraint: kg.ingest_runs.ingest_runs_trigger_allowed
-- creates-constraint: kg.ingest_runs.ingest_runs_source_kind_allowed
-- creates-constraint: kg.ingest_runs.ingest_runs_thread_scope_required
-- creates-constraint: kg.entities.entities_grounding_allowed
-- creates-constraint: kg.entities.entities_provenance_allowed
-- creates-constraint: kg.entities.entities_source_kind_allowed
-- creates-constraint: kg.entities.entities_resolution_state_allowed
-- creates-constraint: kg.relationships.relationships_grounding_allowed
-- creates-constraint: kg.relationships.relationships_provenance_allowed
-- creates-constraint: kg.relationships.relationships_source_kind_allowed
-- creates-constraint: kg.evidence.evidence_source_kind_allowed
-- creates-constraint: kg.evidence.evidence_evidence_source_kind_allowed
-- creates-constraint: kg.evidence.evidence_subject_required
-- creates: public.knowledge_graph_ingest_runs
-- creates: public.knowledge_graph_entities
-- creates: public.knowledge_graph_relationships
-- creates: public.knowledge_graph_evidence
-- creates: public.knowledge_graph_observation_cursors

\set ON_ERROR_STOP on

BEGIN;

-- Set timeouts BEFORE acquiring the advisory lock so the lock acquisition
-- itself is bounded.
SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '300s';

-- Serialize concurrent application attempts.
SELECT pg_advisory_xact_lock(hashtext('kg_schema_extraction'));

-- Refuse to apply against an unexpected DB.
DO $$
BEGIN
  IF current_database() != 'thinkwork' THEN
    RAISE EXCEPTION 'wrong database: %, expected thinkwork', current_database();
  END IF;
END $$;

-- Pre-flight invariants: for each table, assert old name exists AND new
-- name does not. Symmetric checks convert any partial-state scenario into a
-- clear pre-flight error. If the file was already applied (all five moved),
-- the customer runner's unattended re-sweep must be a no-op, so short-circuit
-- cleanly in that case.
DO $$
BEGIN
  IF to_regclass('kg.ingest_runs') IS NOT NULL
     AND to_regclass('kg.entities') IS NOT NULL
     AND to_regclass('kg.relationships') IS NOT NULL
     AND to_regclass('kg.evidence') IS NOT NULL
     AND to_regclass('kg.observation_cursors') IS NOT NULL
     AND to_regclass('public.knowledge_graph_ingest_runs') IS NOT NULL THEN
    -- Already applied (views present at the old names). Nothing to do.
    RETURN;
  END IF;

  IF to_regclass('public.knowledge_graph_ingest_runs') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.knowledge_graph_ingest_runs does not exist';
  END IF;
  IF to_regclass('kg.ingest_runs') IS NOT NULL THEN
    RAISE EXCEPTION 'pre-flight: kg.ingest_runs already exists — refusing to re-apply';
  END IF;
  IF to_regclass('public.knowledge_graph_entities') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.knowledge_graph_entities does not exist';
  END IF;
  IF to_regclass('kg.entities') IS NOT NULL THEN
    RAISE EXCEPTION 'pre-flight: kg.entities already exists — refusing to re-apply';
  END IF;
  IF to_regclass('public.knowledge_graph_relationships') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.knowledge_graph_relationships does not exist';
  END IF;
  IF to_regclass('kg.relationships') IS NOT NULL THEN
    RAISE EXCEPTION 'pre-flight: kg.relationships already exists — refusing to re-apply';
  END IF;
  IF to_regclass('public.knowledge_graph_evidence') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.knowledge_graph_evidence does not exist';
  END IF;
  IF to_regclass('kg.evidence') IS NOT NULL THEN
    RAISE EXCEPTION 'pre-flight: kg.evidence already exists — refusing to re-apply';
  END IF;
  IF to_regclass('public.knowledge_graph_observation_cursors') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.knowledge_graph_observation_cursors does not exist';
  END IF;
  IF to_regclass('kg.observation_cursors') IS NOT NULL THEN
    RAISE EXCEPTION 'pre-flight: kg.observation_cursors already exists — refusing to re-apply';
  END IF;
END $$;

-- Everything below is guarded so the whole file is idempotent for the
-- customer runner's unattended sweep: once applied, the pre-flight above
-- short-circuits nothing (DO blocks can't skip top-level DDL), so each DDL
-- statement carries its own existence guard.

-- Schema creation.
CREATE SCHEMA IF NOT EXISTS kg;
COMMENT ON SCHEMA kg IS 'Knowledge-graph mirror tables. Tenant-scoped entity/relationship/evidence snapshots and the ingest-run ledger. Extracted from public.knowledge_graph_* on 2026-07-14 (THINK-290).';

-- ── Move and rename tables ─────────────────────────────────────────────
-- FK-leaf-first ordering (evidence → relationships → entities →
-- observation_cursors → ingest_runs). Postgres preserves FKs across
-- SET SCHEMA automatically; ordering matters only for operator mental model.

DO $$
BEGIN
  IF to_regclass('public.knowledge_graph_evidence') IS NOT NULL
     AND to_regclass('kg.evidence') IS NULL THEN
    ALTER TABLE public.knowledge_graph_evidence SET SCHEMA kg;
    ALTER TABLE kg.knowledge_graph_evidence RENAME TO evidence;
  END IF;

  IF to_regclass('public.knowledge_graph_relationships') IS NOT NULL
     AND to_regclass('kg.relationships') IS NULL THEN
    ALTER TABLE public.knowledge_graph_relationships SET SCHEMA kg;
    ALTER TABLE kg.knowledge_graph_relationships RENAME TO relationships;
  END IF;

  IF to_regclass('public.knowledge_graph_entities') IS NOT NULL
     AND to_regclass('kg.entities') IS NULL THEN
    ALTER TABLE public.knowledge_graph_entities SET SCHEMA kg;
    ALTER TABLE kg.knowledge_graph_entities RENAME TO entities;
  END IF;

  IF to_regclass('public.knowledge_graph_observation_cursors') IS NOT NULL
     AND to_regclass('kg.observation_cursors') IS NULL THEN
    ALTER TABLE public.knowledge_graph_observation_cursors SET SCHEMA kg;
    ALTER TABLE kg.knowledge_graph_observation_cursors RENAME TO observation_cursors;
  END IF;

  IF to_regclass('public.knowledge_graph_ingest_runs') IS NOT NULL
     AND to_regclass('kg.ingest_runs') IS NULL THEN
    ALTER TABLE public.knowledge_graph_ingest_runs SET SCHEMA kg;
    ALTER TABLE kg.knowledge_graph_ingest_runs RENAME TO ingest_runs;
  END IF;
END $$;

-- ── Rename CHECK constraints to drop the knowledge_graph_ prefix ────────
-- Drizzle's source names these after the (new) table stems; renaming keeps
-- the DB aligned with src/schema/knowledge-graph.ts.

DO $$
DECLARE
  pair record;
BEGIN
  FOR pair IN
    SELECT * FROM (VALUES
      ('kg.ingest_runs',   'knowledge_graph_ingest_runs_status_allowed',            'ingest_runs_status_allowed'),
      ('kg.ingest_runs',   'knowledge_graph_ingest_runs_trigger_allowed',           'ingest_runs_trigger_allowed'),
      ('kg.ingest_runs',   'knowledge_graph_ingest_runs_source_kind_allowed',       'ingest_runs_source_kind_allowed'),
      ('kg.ingest_runs',   'knowledge_graph_ingest_runs_thread_scope_required',     'ingest_runs_thread_scope_required'),
      ('kg.entities',      'knowledge_graph_entities_grounding_allowed',            'entities_grounding_allowed'),
      ('kg.entities',      'knowledge_graph_entities_provenance_allowed',           'entities_provenance_allowed'),
      ('kg.entities',      'knowledge_graph_entities_source_kind_allowed',          'entities_source_kind_allowed'),
      ('kg.entities',      'knowledge_graph_entities_resolution_state_allowed',     'entities_resolution_state_allowed'),
      ('kg.relationships', 'knowledge_graph_relationships_grounding_allowed',       'relationships_grounding_allowed'),
      ('kg.relationships', 'knowledge_graph_relationships_provenance_allowed',      'relationships_provenance_allowed'),
      ('kg.relationships', 'knowledge_graph_relationships_source_kind_allowed',     'relationships_source_kind_allowed'),
      ('kg.evidence',      'knowledge_graph_evidence_source_kind_allowed',          'evidence_source_kind_allowed'),
      ('kg.evidence',      'knowledge_graph_evidence_evidence_source_kind_allowed', 'evidence_evidence_source_kind_allowed'),
      ('kg.evidence',      'knowledge_graph_evidence_subject_required',             'evidence_subject_required')
    ) AS v(tbl, old_name, new_name)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = to_regclass(pair.tbl) AND conname = pair.old_name
    ) THEN
      EXECUTE format('ALTER TABLE %s RENAME CONSTRAINT %I TO %I',
                     pair.tbl, pair.old_name, pair.new_name);
    END IF;
  END LOOP;
END $$;

-- ── Re-point scope-guard trigger functions at kg.* ─────────────────────
-- Bodies below are the 0146/0147 definitions with public.knowledge_graph_*
-- replaced by kg.* (and nothing else changed). CREATE OR REPLACE is
-- idempotent. Function and trigger names keep their original prefixes.

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
  FROM kg.ingest_runs
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
  FROM kg.ingest_runs AS r
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
  FROM kg.entities AS e
  WHERE e.id = NEW.source_entity_id;

  SELECT
      e.tenant_id,
      e.thread_id,
      e.ingest_run_id,
      e.source_kind,
      e.source_ref
    INTO target_tenant, target_thread, target_run, target_kind, target_ref
  FROM kg.entities AS e
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
  FROM kg.ingest_runs AS r
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
    FROM kg.entities AS e
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
    FROM kg.relationships AS r
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

-- ── Compat views in public.* ────────────────────────────────────────────
-- Old bundled Lambda code references public.knowledge_graph_*. Views are
-- column-enumerated per the plan's R6 (none of the five tables has a
-- generated column, so the enumeration is a stability guard, not a
-- workaround). Simple single-table views are auto-updatable, but the
-- ON CONFLICT writers are paused during the window regardless — views
-- reject ON CONFLICT at parse time. The U4 PR drops these.

DO $$
BEGIN
  IF to_regclass('public.knowledge_graph_ingest_runs') IS NULL THEN
    CREATE VIEW public.knowledge_graph_ingest_runs AS
      SELECT id, tenant_id, thread_id, source_kind, source_ref, source_label,
             requested_by_user_id, status, trigger, source_dataset_name,
             source_dataset_id, started_at, finished_at, duration_ms, error,
             entity_count, relationship_count, evidence_count,
             diagnostic_count, message_count, input, metrics, metadata,
             created_at, updated_at
      FROM kg.ingest_runs;
  END IF;

  IF to_regclass('public.knowledge_graph_entities') IS NULL THEN
    CREATE VIEW public.knowledge_graph_entities AS
      SELECT id, tenant_id, thread_id, source_kind, source_ref,
             ingest_run_id, graph_node_id, label, normalized_label,
             type_label, ontology_entity_type_id, ontology_type_slug,
             canonical_entity_id, resolution_state, grounding_status,
             provenance_status, summary, aliases, properties, diagnostics,
             relationship_count, evidence_count, last_seen_at, created_at,
             updated_at
      FROM kg.entities;
  END IF;

  IF to_regclass('public.knowledge_graph_relationships') IS NULL THEN
    CREATE VIEW public.knowledge_graph_relationships AS
      SELECT id, tenant_id, thread_id, source_kind, source_ref,
             ingest_run_id, graph_edge_id, source_entity_id,
             target_entity_id, label, ontology_relationship_type_id,
             ontology_type_slug, grounding_status, provenance_status,
             confidence, properties, diagnostics, evidence_count,
             last_seen_at, created_at, updated_at
      FROM kg.relationships;
  END IF;

  IF to_regclass('public.knowledge_graph_evidence') IS NULL THEN
    CREATE VIEW public.knowledge_graph_evidence AS
      SELECT id, tenant_id, thread_id, source_kind, source_ref,
             ingest_run_id, entity_id, relationship_id, message_id,
             message_role, message_created_at, speaker_label, snippet,
             char_start, char_end, evidence_source_kind,
             evidence_source_ref, metadata, observed_at, created_at
      FROM kg.evidence;
  END IF;

  IF to_regclass('public.knowledge_graph_observation_cursors') IS NULL THEN
    CREATE VIEW public.knowledge_graph_observation_cursors AS
      SELECT tenant_id, bank_id, last_record_updated_at, last_record_id,
             updated_at
      FROM kg.observation_cursors;
  END IF;
END $$;

COMMIT;
