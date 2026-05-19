-- Ontology-gated Brain materialization needs tenant-approved entity type slugs,
-- not a fixed seed-only subtype CHECK.
--
-- drops-constraint: brain.pages.pages_entity_subtype_allowed

ALTER TABLE brain.pages
  DROP CONSTRAINT IF EXISTS pages_entity_subtype_allowed;
