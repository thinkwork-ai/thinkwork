-- Expand the approved seed ontology so Hindsight-to-Wiki compiles have
-- ontology-native types for user memory, travel, place, preference, and work
-- observations instead of falling back to generic Topic/Entity pages.
--
-- creates: public.view_seed_ontology_user_memory_expanded

WITH seed(slug, name, broad_type, description, guidance_notes, aliases) AS (
  VALUES
    ('place', 'Place', 'place', 'A city, country, neighborhood, landmark, or geographic area.', 'Capture why the place matters, parent geography, trips, visits, and user-specific context.', ARRAY['city', 'country', 'neighborhood', 'landmark']::text[]),
    ('venue', 'Venue', 'place', 'A restaurant, hotel, attraction, office, store, or other named location.', 'Compile concrete visit, preference, address, and parent-place evidence without inventing ratings.', ARRAY['restaurant', 'hotel', 'attraction', 'location']::text[]),
    ('trip', 'Trip', 'event', 'A travel plan, itinerary, or remembered travel episode.', 'Group places, venues, dates, companions, and open planning context from cited evidence.', ARRAY['travel', 'itinerary', 'journey']::text[]),
    ('preference', 'Preference', 'preference', 'A durable user preference, taste, constraint, or priority.', 'Keep preferences compact, sourced, and scoped to what the evidence actually says.', ARRAY['taste', 'constraint', 'priority']::text[]),
    ('project', 'Project', 'work', 'A sustained workstream, initiative, or build effort.', 'Track objective, current state, decisions, commitments, risks, and next work.', ARRAY['initiative', 'workstream']::text[]),
    ('task', 'Task', 'work', 'A discrete task, to-do, or follow-up item.', 'Capture owner, status, due date, dependency, and source evidence when available.', ARRAY['todo', 'follow up', 'next step']::text[])
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
    ('located_in', 'Located in', 'Contains', 'venue', 'place', 'Connects a venue or smaller place to its parent geography.', ARRAY['venue', 'place']::text[], ARRAY['place']::text[]),
    ('visited_during', 'Visited during', 'Included visit to', 'venue', 'trip', 'Connects a visited place or venue to the trip where it appeared.', ARRAY['venue', 'place']::text[], ARRAY['trip']::text[]),
    ('about_place', 'About place', 'Place for', 'trip', 'place', 'Connects a trip or preference to a relevant place.', ARRAY['trip', 'preference']::text[], ARRAY['place']::text[]),
    ('has_preference', 'Has preference', 'Preference of', 'person', 'preference', 'Connects a person to a durable preference or constraint.', ARRAY['person']::text[], ARRAY['preference']::text[]),
    ('involves_person', 'Involves person', 'Involved in', 'project', 'person', 'Connects work, travel, or decision context to a person involved in it.', ARRAY['project', 'task', 'trip', 'decision']::text[], ARRAY['person']::text[]),
    ('has_task', 'Has task', 'Task for', 'project', 'task', 'Connects a project or commitment to a concrete task.', ARRAY['project', 'commitment']::text[], ARRAY['task']::text[]),
    ('has_decision', 'Has decision', 'Decision for', 'project', 'decision', 'Connects a project or opportunity to a durable decision.', ARRAY['project', 'opportunity', 'customer']::text[], ARRAY['decision']::text[])
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

WITH seed(entity_slug, slug, heading, facet_type, position, prompt) AS (
  VALUES
    ('place', 'overview', 'Overview', 'compiled', 10, 'Summarize why this place matters in the memory evidence.'),
    ('place', 'location_context', 'Location Context', 'relationship', 20, 'Capture parent geography and nearby or contained places.'),
    ('place', 'related_activity', 'Related Activity', 'activity', 30, 'Capture trips, visits, and remembered events connected to this place.'),
    ('venue', 'overview', 'Overview', 'compiled', 10, 'Summarize what the venue is and why it matters.'),
    ('venue', 'visits', 'Visits', 'activity', 20, 'Capture sourced visits, plans, and context.'),
    ('venue', 'preferences', 'Preferences', 'compiled', 30, 'Capture sourced likes, dislikes, and constraints involving this venue.'),
    ('trip', 'overview', 'Overview', 'compiled', 10, 'Summarize the trip or travel episode.'),
    ('trip', 'itinerary', 'Itinerary', 'activity', 20, 'Capture dates, stops, venues, and open plans.'),
    ('trip', 'places', 'Places', 'relationship', 30, 'List important places and venues connected to the trip.'),
    ('preference', 'summary', 'Summary', 'compiled', 10, 'Summarize the durable preference or constraint.'),
    ('preference', 'evidence', 'Evidence', 'activity', 20, 'Capture the cited observations that support the preference.'),
    ('project', 'overview', 'Overview', 'compiled', 10, 'Summarize the project objective and context.'),
    ('project', 'current_state', 'Current State', 'operational', 20, 'Capture current progress, blockers, and status.'),
    ('project', 'decisions', 'Decisions', 'compiled', 30, 'Capture durable decisions affecting the project.'),
    ('project', 'next_steps', 'Next Steps', 'activity', 40, 'Capture concrete next work.'),
    ('task', 'status', 'Status', 'operational', 10, 'Capture owner, status, due date, and dependency.'),
    ('task', 'evidence', 'Evidence', 'activity', 20, 'Capture source evidence for the task.')
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

CREATE OR REPLACE VIEW public.view_seed_ontology_user_memory_expanded AS
SELECT true AS expanded;
