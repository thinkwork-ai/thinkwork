-- Purpose: type-level system map (THINK-321 U3 / KTD-3 / R6) — per-entity-type
--   declarations of which attached system holds which facets, shaped
--   `{ facet, sourceSystem, note? }`, plus the `identity_map` change-set item
--   type that governs edits (never a direct write).
-- Plan: docs/plans/2026-07-19-001-feat-ontology-identity-crosswalk-agent-routing-plan.md (U3)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0269_ontology_system_map.sql
-- creates-column: ontology.entity_types.system_map
-- creates-column: ontology.entity_types.system_map_version
-- creates-constraint: ontology.change_set_items.ontology_change_set_items_type_allowed

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE ontology.entity_types
  ADD COLUMN IF NOT EXISTS system_map jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE ontology.entity_types
  ADD COLUMN IF NOT EXISTS system_map_version integer NOT NULL DEFAULT 0;

-- R6: `identity_map` change-set items carry system-map edits through the
-- change-set approval loop — widen the item type CHECK to admit the value.
ALTER TABLE ontology.change_set_items
  DROP CONSTRAINT IF EXISTS ontology_change_set_items_type_allowed;
ALTER TABLE ontology.change_set_items
  ADD CONSTRAINT ontology_change_set_items_type_allowed
  CHECK (item_type IN ('entity_type','relationship_type','facet_template','external_mapping','identity_map'));

COMMIT;
