-- Expand the approved seed ontology so ontology-backed wiki pages can form
-- useful subject-predicate-object triples instead of isolated nodes.
--
-- creates: public.view_seed_ontology_triples_expanded

WITH seed(slug, name, broad_type, description, guidance_notes, aliases) AS (
  VALUES
    ('activity', 'Activity', 'event', 'A dated event, class, camp, attraction, festival, or planned thing-to-do.', 'Use Activity for events and experiences; use Venue for the named physical location that hosts or contains them.', ARRAY['event', 'attraction', 'camp', 'class', 'festival', 'thing to do']::text[])
),
active_versions AS (
  SELECT DISTINCT ON (tenant_id) id, tenant_id
  FROM ontology.versions
  WHERE status = 'active'
  ORDER BY tenant_id, version_number DESC
)
INSERT INTO ontology.entity_types (
  tenant_id,
  version_id,
  slug,
  name,
  broad_type,
  description,
  guidance_notes,
  aliases,
  lifecycle_status,
  approved_at
)
SELECT
  v.tenant_id,
  v.id,
  seed.slug,
  seed.name,
  seed.broad_type,
  seed.description,
  seed.guidance_notes,
  seed.aliases,
  'approved',
  now()
FROM active_versions v
CROSS JOIN seed
ON CONFLICT (tenant_id, slug) DO UPDATE
SET
  name = EXCLUDED.name,
  broad_type = EXCLUDED.broad_type,
  description = EXCLUDED.description,
  guidance_notes = EXCLUDED.guidance_notes,
  aliases = EXCLUDED.aliases,
  lifecycle_status = 'approved',
  approved_at = COALESCE(ontology.entity_types.approved_at, now()),
  updated_at = now();

WITH seed(slug, name, inverse_name, source_slug, target_slug, description, source_type_slugs, target_type_slugs) AS (
  VALUES
    ('lives_in', 'Lives in', 'Home of', 'person', 'place', 'Connects a person to a home city, region, or place of residence.', ARRAY['person']::text[], ARRAY['place']::text[]),
    ('visited', 'Visited', 'Visited by', 'person', 'venue', 'Connects a person to a place, venue, trip, or activity they visited, attended, or experienced.', ARRAY['person']::text[], ARRAY['venue', 'place', 'trip', 'activity']::text[]),
    ('interested_in', 'Interested in', 'Interest of', 'person', 'activity', 'Connects a person to a potential activity, venue, place, or preference they are considering or like.', ARRAY['person']::text[], ARRAY['activity', 'venue', 'place', 'preference']::text[]),
    ('takes_place_at', 'Takes place at', 'Hosts activity', 'activity', 'place', 'Connects an activity, event, or trip to the venue or place where it happens.', ARRAY['activity', 'trip']::text[], ARRAY['venue', 'place']::text[]),
    ('has_order', 'Has order', 'Order for', 'customer', 'order', 'Connects a customer to an order or commercial transaction.', ARRAY['customer']::text[], ARRAY['order']::text[]),
    ('fulfilled_at', 'Fulfilled at', 'Fulfillment site for', 'order', 'place', 'Connects an order to a pickup, delivery, terminal, or service place.', ARRAY['order']::text[], ARRAY['place', 'venue']::text[]),
    ('serves_place', 'Serves place', 'Served by', 'customer', 'place', 'Connects a customer or service organization to a service area or operating place.', ARRAY['customer']::text[], ARRAY['place']::text[]),
    ('related_case', 'Related case', 'Related case', 'support_case', 'support_case', 'Connects support cases that describe the same incident, regression, or follow-up.', ARRAY['support_case']::text[], ARRAY['support_case']::text[])
)
INSERT INTO ontology.relationship_types (
  tenant_id,
  version_id,
  slug,
  name,
  inverse_name,
  source_entity_type_id,
  target_entity_type_id,
  source_type_slugs,
  target_type_slugs,
  description,
  lifecycle_status,
  approved_at
)
SELECT
  source_type.tenant_id,
  source_type.version_id,
  seed.slug,
  seed.name,
  seed.inverse_name,
  source_type.id,
  target_type.id,
  seed.source_type_slugs,
  seed.target_type_slugs,
  seed.description,
  'approved',
  now()
FROM seed
JOIN ontology.entity_types source_type
  ON source_type.slug = seed.source_slug
JOIN ontology.entity_types target_type
  ON target_type.tenant_id = source_type.tenant_id
  AND target_type.slug = seed.target_slug
ON CONFLICT (tenant_id, slug) DO UPDATE
SET
  name = EXCLUDED.name,
  inverse_name = EXCLUDED.inverse_name,
  source_entity_type_id = EXCLUDED.source_entity_type_id,
  target_entity_type_id = EXCLUDED.target_entity_type_id,
  source_type_slugs = EXCLUDED.source_type_slugs,
  target_type_slugs = EXCLUDED.target_type_slugs,
  description = EXCLUDED.description,
  lifecycle_status = 'approved',
  approved_at = COALESCE(ontology.relationship_types.approved_at, now()),
  updated_at = now();

WITH expanded(slug, source_type_slugs, target_type_slugs, source_slug, target_slug) AS (
  VALUES
    ('located_in', ARRAY['venue', 'place', 'activity']::text[], ARRAY['place']::text[], 'venue', 'place'),
    ('about_place', ARRAY['trip', 'preference', 'activity']::text[], ARRAY['place']::text[], 'trip', 'place'),
    ('involves_person', ARRAY['project', 'task', 'trip', 'decision', 'support_case', 'order', 'activity', 'venue', 'preference']::text[], ARRAY['person']::text[], 'project', 'person'),
    ('has_task', ARRAY['project', 'commitment', 'support_case', 'person']::text[], ARRAY['task']::text[], 'project', 'task')
)
UPDATE ontology.relationship_types relationship
SET
  source_entity_type_id = source_type.id,
  target_entity_type_id = target_type.id,
  source_type_slugs = expanded.source_type_slugs,
  target_type_slugs = expanded.target_type_slugs,
  lifecycle_status = 'approved',
  approved_at = COALESCE(relationship.approved_at, now()),
  updated_at = now()
FROM expanded
JOIN ontology.entity_types source_type
  ON source_type.slug = expanded.source_slug
JOIN ontology.entity_types target_type
  ON target_type.tenant_id = source_type.tenant_id
  AND target_type.slug = expanded.target_slug
WHERE relationship.tenant_id = source_type.tenant_id
  AND relationship.slug = expanded.slug;

WITH seed(entity_slug, slug, heading, facet_type, position, prompt) AS (
  VALUES
    ('activity', 'overview', 'Overview', 'compiled', 10, 'Summarize what the activity is and why it matters.'),
    ('activity', 'schedule', 'Schedule', 'activity', 20, 'Capture dates, times, seasonality, and status when present.'),
    ('activity', 'location', 'Location', 'relationship', 30, 'Capture the venue or place where the activity happens.'),
    ('activity', 'participants', 'Participants', 'relationship', 40, 'Capture people involved, attending, or interested.')
)
INSERT INTO ontology.facet_templates (
  tenant_id,
  entity_type_id,
  slug,
  heading,
  facet_type,
  position,
  prompt,
  lifecycle_status
)
SELECT
  entity_types.tenant_id,
  entity_types.id,
  seed.slug,
  seed.heading,
  seed.facet_type,
  seed.position,
  seed.prompt,
  'approved'
FROM seed
JOIN ontology.entity_types
  ON entity_types.slug = seed.entity_slug
ON CONFLICT (entity_type_id, slug) DO UPDATE
SET
  heading = EXCLUDED.heading,
  facet_type = EXCLUDED.facet_type,
  position = EXCLUDED.position,
  prompt = EXCLUDED.prompt,
  lifecycle_status = 'approved',
  updated_at = now();

CREATE OR REPLACE VIEW public.view_seed_ontology_triples_expanded AS
SELECT true AS expanded;
