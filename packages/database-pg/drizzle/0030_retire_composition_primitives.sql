-- Retire composition-era primitive skills (pure-skill-spec cleanup).
--
-- Post plan §U6 the composition runner is gone, and every deliverable-shape
-- skill (sales-prep, account-health-review, renewal-prep, customer-onboarding-
-- reconciler) has been rewritten as a pure Claude-spec SKILL.md that inlines
-- framing + synthesis. The four workflow primitives that used to be invoked
-- between a deliverable's steps -- frame, synthesize, gather, compound -- no
-- longer have callers. This migration deletes them from every tenant + agent
-- install so the admin catalog, workspace-map generator, and session
-- allowlist stop listing stale slugs.
--
-- The YAML directories + S3 artifacts for those slugs are removed in the same
-- PR's commit. The sync-catalog-db.ts script also deletes retired builtin
-- rows on every deploy as a belt-and-suspenders invariant, but this migration
-- cleans them up explicitly on the stage that applies it first.
--
-- Apply manually (matches the 0018+ hand-rolled convention):
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0030_retire_composition_primitives.sql
--
-- Drift detection:
--   pnpm db:migrate-manual
--
-- Idempotency:
--   DELETEs are naturally idempotent; the marker view uses CREATE OR REPLACE.
--
-- creates: public.view_composition_primitives_retired

-- Drop any agent-level installs first so no agent keeps pointing at a slug
-- the catalog no longer exposes. agent_skills.skill_id is the slug text,
-- no FK -- direct DELETE is safe.
DELETE FROM agent_skills
WHERE skill_id IN ('frame', 'synthesize', 'gather', 'compound');

-- Tenant-level installs next.
DELETE FROM tenant_skills
WHERE skill_id IN ('frame', 'synthesize', 'gather', 'compound');

-- Finally drop the catalog rows themselves.
DELETE FROM skill_catalog
WHERE slug IN ('frame', 'synthesize', 'gather', 'compound');

-- Marker view — lets the db-migrate-manual drift reporter confirm this
-- migration applied. Cheap and isolated; the view returns the apply time
-- so operators can also audit when retirement happened on each stage.
CREATE OR REPLACE VIEW public.view_composition_primitives_retired AS
SELECT
  NOW() AS retired_at,
  ARRAY['frame', 'synthesize', 'gather', 'compound']::text[] AS retired_slugs;
