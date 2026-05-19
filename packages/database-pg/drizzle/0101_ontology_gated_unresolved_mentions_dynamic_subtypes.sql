-- Ontology-gate rejections must preserve tenant-approved or proposed entity
-- slugs as suggestion evidence, not only the legacy seed subtype list.
--
-- drops-constraint: wiki.unresolved_mentions.unresolved_mentions_entity_subtype_allowed

ALTER TABLE wiki.unresolved_mentions
  DROP CONSTRAINT IF EXISTS unresolved_mentions_entity_subtype_allowed;
