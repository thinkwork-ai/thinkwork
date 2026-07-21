-- Purpose: Company Brain twin declarations (plan 2026-07-21-001 U3 / KTD-3) —
--   per-entity-type facet declarations (clone policy + cadence + attribute
--   mappings) and page-section declarations, per-relationship-type source
--   bindings (deterministic FK edge population), plus the three change-set
--   item types that govern edits (`facet_declaration`, `relationship_binding`,
--   `page_section`). The compiled twin mapping export is regenerated from
--   these columns on every change-set apply.
-- Plan: docs/plans/2026-07-21-001-feat-company-brain-digital-twin-plan.md (U3)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0271_ontology_twin_declarations.sql
-- creates-column: ontology.entity_types.twin_facets
-- creates-column: ontology.entity_types.twin_facets_version
-- creates-column: ontology.entity_types.page_sections
-- creates-column: ontology.entity_types.page_sections_version
-- creates-column: ontology.relationship_types.source_binding
-- creates-column: ontology.relationship_types.source_binding_version
-- creates-constraint: ontology.change_set_items.ontology_change_set_items_type_allowed

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE ontology.entity_types
  ADD COLUMN IF NOT EXISTS twin_facets jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE ontology.entity_types
  ADD COLUMN IF NOT EXISTS twin_facets_version integer NOT NULL DEFAULT 0;
ALTER TABLE ontology.entity_types
  ADD COLUMN IF NOT EXISTS page_sections jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE ontology.entity_types
  ADD COLUMN IF NOT EXISTS page_sections_version integer NOT NULL DEFAULT 0;

ALTER TABLE ontology.relationship_types
  ADD COLUMN IF NOT EXISTS source_binding jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE ontology.relationship_types
  ADD COLUMN IF NOT EXISTS source_binding_version integer NOT NULL DEFAULT 0;

-- Widen the item-type CHECK to admit the three twin declaration item types
-- (constraint-widening deploys before writer code per house convention).
ALTER TABLE ontology.change_set_items
  DROP CONSTRAINT IF EXISTS ontology_change_set_items_type_allowed;
ALTER TABLE ontology.change_set_items
  ADD CONSTRAINT ontology_change_set_items_type_allowed
  CHECK (item_type IN ('entity_type','relationship_type','facet_template','external_mapping','identity_map','facet_declaration','relationship_binding','page_section'));

COMMIT;
