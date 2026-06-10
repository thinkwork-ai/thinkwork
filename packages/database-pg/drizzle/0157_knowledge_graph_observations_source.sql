-- Purpose: admit Hindsight observations as a Knowledge Graph ingest source and
--          add per-(tenant, bank) incremental cursors for the tenant fan-in.
-- Plan: docs/plans/2026-06-09-004-feat-cognee-centric-memory-pipeline-plan.md (U4)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0157_knowledge_graph_observations_source.sql
-- creates: public.knowledge_graph_observation_cursors
-- creates: public.uq_kg_observation_cursors_tenant_bank
-- creates: public.idx_kg_observation_cursors_tenant
-- creates-constraint: public.knowledge_graph_ingest_runs.knowledge_graph_ingest_runs_source_kind_allowed
-- creates-constraint: public.knowledge_graph_ingest_runs.knowledge_graph_ingest_runs_trigger_allowed
-- creates-constraint: public.knowledge_graph_entities.knowledge_graph_entities_source_kind_allowed
-- creates-constraint: public.knowledge_graph_relationships.knowledge_graph_relationships_source_kind_allowed
-- creates-constraint: public.knowledge_graph_evidence.knowledge_graph_evidence_source_kind_allowed
-- creates-constraint: public.knowledge_graph_evidence.knowledge_graph_evidence_evidence_source_kind_allowed

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';

-- Source-kind vocabulary gains 'observations'. Constraint re-adds validate
-- against existing rows; all current rows use thread/wiki/brain, so widening
-- is safe in either deploy order.
ALTER TABLE public.knowledge_graph_ingest_runs
  DROP CONSTRAINT IF EXISTS knowledge_graph_ingest_runs_source_kind_allowed;
ALTER TABLE public.knowledge_graph_ingest_runs
  ADD CONSTRAINT knowledge_graph_ingest_runs_source_kind_allowed
  CHECK (source_kind IN ('thread','wiki','brain','observations'));

-- U5's drainer schedules observation runs; 'manual' stays the default.
ALTER TABLE public.knowledge_graph_ingest_runs
  DROP CONSTRAINT IF EXISTS knowledge_graph_ingest_runs_trigger_allowed;
ALTER TABLE public.knowledge_graph_ingest_runs
  ADD CONSTRAINT knowledge_graph_ingest_runs_trigger_allowed
  CHECK ("trigger" IN ('manual','scheduled'));

ALTER TABLE public.knowledge_graph_entities
  DROP CONSTRAINT IF EXISTS knowledge_graph_entities_source_kind_allowed;
ALTER TABLE public.knowledge_graph_entities
  ADD CONSTRAINT knowledge_graph_entities_source_kind_allowed
  CHECK (source_kind IN ('thread','wiki','brain','observations'));

ALTER TABLE public.knowledge_graph_relationships
  DROP CONSTRAINT IF EXISTS knowledge_graph_relationships_source_kind_allowed;
ALTER TABLE public.knowledge_graph_relationships
  ADD CONSTRAINT knowledge_graph_relationships_source_kind_allowed
  CHECK (source_kind IN ('thread','wiki','brain','observations'));

ALTER TABLE public.knowledge_graph_evidence
  DROP CONSTRAINT IF EXISTS knowledge_graph_evidence_source_kind_allowed;
ALTER TABLE public.knowledge_graph_evidence
  ADD CONSTRAINT knowledge_graph_evidence_source_kind_allowed
  CHECK (source_kind IN ('thread','wiki','brain','observations'));

ALTER TABLE public.knowledge_graph_evidence
  DROP CONSTRAINT IF EXISTS knowledge_graph_evidence_evidence_source_kind_allowed;
ALTER TABLE public.knowledge_graph_evidence
  ADD CONSTRAINT knowledge_graph_evidence_evidence_source_kind_allowed
  CHECK (evidence_source_kind IN ('thread_message','wiki_page','wiki_section','brain_page','brain_section','hindsight_observation','cognee_payload','normalizer'));

-- Per-(tenant, bank) cursors for the observations fan-in. The
-- (last_record_updated_at, last_record_id) pair mirrors the wiki compile
-- cursor tiebreaker; cursors advance only in the same transaction as the
-- mirror snapshot replace.
CREATE TABLE IF NOT EXISTS public.knowledge_graph_observation_cursors (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  bank_id text NOT NULL,
  last_record_updated_at timestamptz,
  last_record_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_kg_observation_cursors_tenant_bank
  ON public.knowledge_graph_observation_cursors (tenant_id, bank_id);

CREATE INDEX IF NOT EXISTS idx_kg_observation_cursors_tenant
  ON public.knowledge_graph_observation_cursors (tenant_id);

COMMIT;
