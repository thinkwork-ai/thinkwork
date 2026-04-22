-- Unit 4 (R13/R14) — Seed `thinkwork-admin` permissions.operations on
-- every existing agent_templates row whose skills list includes the
-- skill but hasn't yet authored an operations allowlist.
--
-- See docs/plans/2026-04-22-008-feat-agent-skill-permissions-ui-plan.md
-- (Unit 4). The thinkwork-admin skill's authz middle layer requires
-- `agent_skills.permissions.operations` to be populated before any op
-- call succeeds (see packages/api/src/graphql/resolvers/core/authz.ts,
-- `requireAgentAllowsOperation`). Agents inherit from the template
-- when their own permissions is null — so seeding the template is
-- sufficient to unblock every existing agent that carries the skill.
--
-- The 29 ops below are the `default_enabled: true` entries in
-- packages/skill-catalog/thinkwork-admin/skill.yaml as of this
-- migration. Destructive opt-ins (remove_tenant_member,
-- remove_team_agent, remove_team_user, sync_template_to_all_agents)
-- are NOT seeded — operators opt into them deliberately via the UI
-- landing in Phase 4.
--
-- If the manifest's default_enabled set changes after this ships, a
-- new migration (not an edit of this one) adds or removes the ops
-- for existing templates. This file is frozen.
--
-- Apply manually (matches the 0019/0020 convention):
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0022_seed_thinkwork_admin_permissions.sql
--
-- Drift detection:
--   bash scripts/db-migrate-manual.sh
--
-- Pre-migration invariants:
--   - agent_templates exists with a jsonb `skills` column.
--   - skill_catalog exists and has a row for slug='thinkwork-admin'.
--
-- Idempotency: the UPDATE only rewrites jsonb array elements whose
-- `permissions` is NULL, an empty object, or missing the `operations`
-- key. Running the file twice is a no-op. Operators who pre-authored
-- permissions via direct SQL retain their choices.
--
-- creates: public.view_thinkwork_admin_permissions_seeded
--
-- Sentinel view below is the drift-reporter anchor. It expresses the
-- post-migration invariant so db-migrate-manual.sh has something
-- concrete to check in CI — this is otherwise a pure-data migration
-- with no schema object.

-- Pre-flight: refuse to run against a DB that's missing the target
-- tables. Fail loudly rather than silently doing nothing.
DO $$
BEGIN
  IF to_regclass('public.agent_templates') IS NULL THEN
    RAISE EXCEPTION 'agent_templates not found; apply earlier migrations first';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Seed thinkwork-admin permissions.operations on every template that
-- lists the skill.
--
-- Strategy: for each agent_templates row, rebuild `skills` by mapping
-- over the array. For entries where skill_id='thinkwork-admin' and
-- permissions is missing/empty/lacks-operations, stitch in the default
-- ops. All other entries pass through untouched.
-- ---------------------------------------------------------------------------

UPDATE agent_templates AS t
SET skills = sub.new_skills
FROM (
  SELECT
    id,
    (
      SELECT jsonb_agg(
        CASE
          WHEN (elem->>'skill_id') = 'thinkwork-admin'
            AND (
              NOT (elem ? 'permissions')
              OR elem->'permissions' IS NULL
              OR jsonb_typeof(elem->'permissions') = 'null'
              OR elem->'permissions' = '{}'::jsonb
              OR NOT (elem->'permissions' ? 'operations')
            )
          THEN jsonb_set(
            elem,
            '{permissions}',
            jsonb_build_object(
              'operations',
              jsonb_build_array(
                'me',
                'get_tenant',
                'get_tenant_by_slug',
                'get_user',
                'list_tenant_members',
                'list_agents',
                'get_agent',
                'list_all_tenant_agents',
                'list_templates',
                'get_template',
                'list_linked_agents_for_template',
                'list_teams',
                'get_team',
                'list_artifacts',
                'get_artifact',
                'update_tenant',
                'add_tenant_member',
                'update_tenant_member',
                'invite_member',
                'create_team',
                'add_team_agent',
                'add_team_user',
                'create_agent',
                'set_agent_skills',
                'set_agent_capabilities',
                'create_agent_template',
                'create_agent_from_template',
                'sync_template_to_agent',
                'accept_template_update'
              )
            )
          )
          ELSE elem
        END
        ORDER BY ordinality
      )
      FROM jsonb_array_elements(t.skills) WITH ORDINALITY AS arr(elem, ordinality)
    ) AS new_skills
  FROM agent_templates AS t
  WHERE jsonb_typeof(t.skills) = 'array'
    AND t.skills @> '[{"skill_id": "thinkwork-admin"}]'::jsonb
) AS sub
WHERE t.id = sub.id
  AND sub.new_skills IS NOT NULL
  AND sub.new_skills IS DISTINCT FROM t.skills;

-- ---------------------------------------------------------------------------
-- Drift-reporter sentinel.
--
-- A trivial view asserting the post-migration invariant: every template
-- referencing thinkwork-admin has a non-null permissions.operations
-- array for that skill. Reporter gates on the view's existence, which
-- proves the migration ran. The view itself is cheap (no rows unless
-- there's a drift) and expresses intent in SQL rather than prose.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.view_thinkwork_admin_permissions_seeded AS
SELECT
  t.id AS template_id,
  t.tenant_id,
  t.slug
FROM agent_templates t,
     jsonb_array_elements(t.skills) AS s
WHERE (s->>'skill_id') = 'thinkwork-admin'
  AND (
    NOT (s ? 'permissions')
    OR s->'permissions' IS NULL
    OR jsonb_typeof(s->'permissions') = 'null'
    OR NOT (s->'permissions' ? 'operations')
  );

COMMENT ON VIEW public.view_thinkwork_admin_permissions_seeded IS
  'Unit 4 invariant check — rows here indicate a thinkwork-admin template '
  'assignment missing permissions.operations. Expected to be empty post-seed.';
