-- Purpose: durable candidate-rejection fingerprints (KTD-6 / R13) and the
--   `deferred` change-set item status (R15) for the Ontology Living Map.
-- Plan: docs/plans/2026-07-18-001-feat-ontology-living-map-plan.md (U2)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0267_ontology_candidate_rejections.sql
-- creates: ontology.candidate_rejections
-- creates: ontology.uq_ontology_candidate_rejections_fingerprint
-- creates: ontology.idx_ontology_candidate_rejections_tenant
-- creates-constraint: ontology.candidate_rejections.ontology_candidate_rejections_tenant_id_tenants_id_fk
-- creates-constraint: ontology.candidate_rejections.ontology_candidate_rejections_kind_allowed
-- creates-constraint: ontology.change_set_items.ontology_change_set_items_status_allowed

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS ontology.candidate_rejections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  kind text NOT NULL,
  slug text NOT NULL,
  fingerprint text NOT NULL,
  rejected_by uuid,
  rejected_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ontology_candidate_rejections_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT ontology_candidate_rejections_rejected_by_users_id_fk
    FOREIGN KEY (rejected_by)
    REFERENCES public.users(id)
    ON DELETE SET NULL,
  CONSTRAINT ontology_candidate_rejections_kind_allowed
    CHECK (kind IN ('entity_type','relationship_type','facet_template','external_mapping'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ontology_candidate_rejections_fingerprint
  ON ontology.candidate_rejections (tenant_id, kind, fingerprint);

CREATE INDEX IF NOT EXISTS idx_ontology_candidate_rejections_tenant
  ON ontology.candidate_rejections (tenant_id);

-- R15: excluded-at-approval items become `deferred` (re-reviewable) — widen
-- the item status CHECK to admit the new value.
ALTER TABLE ontology.change_set_items
  DROP CONSTRAINT IF EXISTS ontology_change_set_items_status_allowed;
ALTER TABLE ontology.change_set_items
  ADD CONSTRAINT ontology_change_set_items_status_allowed
  CHECK (status IN ('pending_review','approved','rejected','applied','deferred'));

COMMIT;
