-- Purpose: backfill legacy Agent Templates into Agent-owned runtime fields and Space context modules.
-- Plan: docs/plans/2026-05-20-003-spaces-as-agent-contextual-workrooms-template-removal-plan.md (U5)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0114_migrate_templates_to_agents_and_spaces.sql
-- creates: public.idx_spaces_migrated_template

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '180s';

CREATE INDEX IF NOT EXISTS idx_spaces_migrated_template
  ON public.spaces (tenant_id, template_key)
  WHERE template_key LIKE 'agent-template:%';

-- Every tenant gets a contextual default Space. This is distinct from the
-- legacy "general" thread bucket and becomes the baseline Space for
-- template-free agents during the hard-cut migration.
INSERT INTO public.spaces (
  tenant_id,
  slug,
  name,
  description,
  prompt,
  status,
  kind,
  icon,
  category,
  template_key,
  config,
  context_config,
  connected_data_config,
  tool_policy,
  mcp_policy,
  agent_availability_policy
)
SELECT
  t.id,
  'default',
  'Default',
  'Default contextual workspace for tenant agents.',
  'Use this Space for baseline agent context that should be available when no specialized Space applies.',
  'active',
  'custom',
  'folder',
  'default',
  'default',
  jsonb_build_object(
    'workflow', 'default',
    'version', 1,
    'source', 'template_migration',
    'migration', '0114_migrate_templates_to_agents_and_spaces'
  ),
  jsonb_build_object(
    'source', 'template_migration',
    'workspaceSourcePrefix', format('tenants/%s/spaces/default/source/', t.slug),
    'legacyDefaultsPrefix', format('tenants/%s/agents/_catalog/defaults/workspace/', t.slug)
  ),
  '{}'::jsonb,
  jsonb_build_object('source', 'template_migration'),
  jsonb_build_object('source', 'template_migration'),
  jsonb_build_object(
    'source', 'template_migration',
    'autoSubscribeAssignedAgents', true
  )
FROM public.tenants t
ON CONFLICT (tenant_id, slug)
DO UPDATE SET
  status = 'active',
  kind = COALESCE(public.spaces.kind, EXCLUDED.kind),
  icon = COALESCE(public.spaces.icon, EXCLUDED.icon),
  category = COALESCE(public.spaces.category, EXCLUDED.category),
  template_key = COALESCE(public.spaces.template_key, EXCLUDED.template_key),
  config = COALESCE(public.spaces.config, '{}'::jsonb) || EXCLUDED.config,
  context_config = COALESCE(public.spaces.context_config, '{}'::jsonb) || EXCLUDED.context_config,
  connected_data_config = COALESCE(public.spaces.connected_data_config, EXCLUDED.connected_data_config),
  tool_policy = COALESCE(public.spaces.tool_policy, '{}'::jsonb) || EXCLUDED.tool_policy,
  mcp_policy = COALESCE(public.spaces.mcp_policy, '{}'::jsonb) || EXCLUDED.mcp_policy,
  agent_availability_policy = COALESCE(public.spaces.agent_availability_policy, '{}'::jsonb) || EXCLUDED.agent_availability_policy,
  updated_at = now();

-- Copy durable runtime and built-in policy fields from linked Templates onto
-- Agents. Runtime is intentionally overwritten because old agent rows default
-- to "strands" even when their Template selected a different runtime.
UPDATE public.agents a
SET
  runtime = COALESCE(t.runtime, a.runtime, 'strands'),
  model = COALESCE(a.model, t.model),
  guardrail_id = COALESCE(a.guardrail_id, t.guardrail_id),
  blocked_tools = COALESCE(t.blocked_tools, a.blocked_tools),
  sandbox = COALESCE(t.sandbox, a.sandbox),
  browser = COALESCE(t.browser, a.browser),
  web_search = COALESCE(t.web_search, a.web_search),
  send_email = COALESCE(t.send_email, a.send_email),
  context_engine = COALESCE(t.context_engine, a.context_engine),
  updated_at = now()
FROM public.agent_templates t
WHERE a.template_id = t.id;

-- Materialize a Space for every meaningful tenant-scoped, non-default Agent
-- Template so Template context can be reviewed and carried forward as Space
-- context. Default templates feed the tenant "default" Space above.
INSERT INTO public.spaces (
  tenant_id,
  slug,
  name,
  description,
  prompt,
  status,
  kind,
  icon,
  category,
  template_key,
  config,
  context_config,
  connected_data_config,
  tool_policy,
  mcp_policy,
  agent_availability_policy
)
SELECT
  t.tenant_id,
  'template-' || regexp_replace(lower(t.slug), '[^a-z0-9]+', '-', 'g'),
  t.name,
  t.description,
  COALESCE(t.config->>'systemPrompt', t.description),
  'active',
  'custom',
  COALESCE(t.icon, 'folder'),
  COALESCE(t.category, 'template'),
  'agent-template:' || t.slug,
  jsonb_build_object(
    'workflow', 'template_migration',
    'version', 1,
    'source', 'template_migration',
    'migration', '0114_migrate_templates_to_agents_and_spaces',
    'legacyTemplateId', t.id::text,
    'legacyTemplateSlug', t.slug,
    'legacyTemplateKind', t.template_kind,
    'legacyTemplateSource', t.source
  ),
  jsonb_strip_nulls(jsonb_build_object(
    'source', 'template_migration',
    'sourceKind', 'agent_template',
    'legacyTemplateId', t.id::text,
    'legacyTemplateSlug', t.slug,
    'workspaceSourcePrefix', format('tenants/%s/spaces/%s/source/', tenant.slug, 'template-' || regexp_replace(lower(t.slug), '[^a-z0-9]+', '-', 'g')),
    'legacyTemplatePrefix', format('tenants/%s/agents/_catalog/%s/workspace/', tenant.slug, t.slug),
    'legacyDefaultsPrefix', format('tenants/%s/agents/_catalog/defaults/workspace/', tenant.slug),
    'skills', CASE WHEN jsonb_typeof(t.skills) = 'array' THEN t.skills ELSE '[]'::jsonb END,
    'knowledgeBaseIds', CASE WHEN jsonb_typeof(t.knowledge_base_ids) = 'array' THEN t.knowledge_base_ids ELSE '[]'::jsonb END
  )),
  '{}'::jsonb,
  jsonb_strip_nulls(jsonb_build_object(
    'source', 'template_migration',
    'blockedTools', t.blocked_tools,
    'builtIns', jsonb_strip_nulls(jsonb_build_object(
      'sandbox', t.sandbox,
      'browser', t.browser,
      'webSearch', t.web_search,
      'sendEmail', t.send_email,
      'contextEngine', t.context_engine
    ))
  )),
  jsonb_build_object(
    'source', 'template_migration',
    'bindingSource', 'agent_template_mcp_servers'
  ),
  jsonb_build_object(
    'source', 'template_migration',
    'legacyTemplateId', t.id::text,
    'autoSubscribeAssignedAgents', true
  )
FROM public.agent_templates t
JOIN public.tenants tenant
  ON tenant.id = t.tenant_id
WHERE t.tenant_id IS NOT NULL
  AND t.template_kind = 'agent'
  AND t.slug <> 'default'
ON CONFLICT (tenant_id, slug)
DO UPDATE SET
  template_key = EXCLUDED.template_key,
  config = COALESCE(public.spaces.config, '{}'::jsonb) || EXCLUDED.config,
  context_config = COALESCE(public.spaces.context_config, '{}'::jsonb) || EXCLUDED.context_config,
  tool_policy = COALESCE(public.spaces.tool_policy, '{}'::jsonb) || EXCLUDED.tool_policy,
  mcp_policy = COALESCE(public.spaces.mcp_policy, '{}'::jsonb) || EXCLUDED.mcp_policy,
  agent_availability_policy = COALESCE(public.spaces.agent_availability_policy, '{}'::jsonb) || EXCLUDED.agent_availability_policy,
  updated_at = now();

-- Existing Agents should keep their skill, KB, and MCP behavior even after
-- Templates stop being a live configuration concept.
INSERT INTO public.agent_skills (
  agent_id,
  tenant_id,
  skill_id,
  config,
  permissions,
  rate_limit_rpm,
  model_override,
  enabled
)
SELECT
  a.id,
  a.tenant_id,
  skill.skill_id,
  skill.config,
  skill.permissions,
  skill.rate_limit_rpm,
  skill.model_override,
  COALESCE(skill.enabled, true)
FROM public.agents a
JOIN public.agent_templates t
  ON t.id = a.template_id
CROSS JOIN LATERAL jsonb_to_recordset(
  CASE WHEN jsonb_typeof(t.skills) = 'array' THEN t.skills ELSE '[]'::jsonb END
) AS skill(
  skill_id text,
  config jsonb,
  permissions jsonb,
  rate_limit_rpm integer,
  model_override text,
  enabled boolean
)
WHERE skill.skill_id IS NOT NULL
ON CONFLICT (agent_id, skill_id)
DO NOTHING;

INSERT INTO public.agent_knowledge_bases (
  agent_id,
  tenant_id,
  knowledge_base_id,
  enabled
)
SELECT
  a.id,
  a.tenant_id,
  kb.knowledge_base_id::uuid,
  true
FROM public.agents a
JOIN public.agent_templates t
  ON t.id = a.template_id
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE WHEN jsonb_typeof(t.knowledge_base_ids) = 'array' THEN t.knowledge_base_ids ELSE '[]'::jsonb END
) AS kb(knowledge_base_id)
WHERE kb.knowledge_base_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
ON CONFLICT (agent_id, knowledge_base_id)
DO NOTHING;

INSERT INTO public.agent_mcp_servers (
  agent_id,
  tenant_id,
  mcp_server_id,
  enabled,
  config
)
SELECT
  a.id,
  a.tenant_id,
  atm.mcp_server_id,
  COALESCE(atm.enabled, true),
  atm.config
FROM public.agents a
JOIN public.agent_template_mcp_servers atm
  ON atm.template_id = a.template_id
ON CONFLICT (agent_id, mcp_server_id)
DO NOTHING;

-- Make Agents available inside their migrated Template Space. Agents that
-- were already template-free go to the tenant default Space so every Agent
-- has at least one contextual workroom.
WITH agent_target_spaces AS (
  SELECT
    a.tenant_id,
    a.id AS agent_id,
    COALESCE(template_space.id, default_space.id) AS space_id,
    t.id AS legacy_template_id,
    t.slug AS legacy_template_slug
  FROM public.agents a
  LEFT JOIN public.agent_templates t
    ON t.id = a.template_id
  JOIN public.spaces default_space
    ON default_space.tenant_id = a.tenant_id
   AND default_space.slug = 'default'
  LEFT JOIN public.spaces template_space
    ON template_space.tenant_id = a.tenant_id
   AND template_space.slug = 'template-' || regexp_replace(lower(t.slug), '[^a-z0-9]+', '-', 'g')
   AND t.slug <> 'default'
)
INSERT INTO public.space_agent_assignments (
  tenant_id,
  space_id,
  agent_id,
  local_role,
  local_instructions,
  auto_subscribe,
  allowed_capabilities,
  allowed_tools,
  status
)
SELECT
  ats.tenant_id,
  ats.space_id,
  ats.agent_id,
  'agent',
  CASE
    WHEN ats.legacy_template_slug IS NULL THEN 'Assigned by Template removal migration as a template-free agent.'
    ELSE format('Assigned by Template removal migration from legacy template %s.', ats.legacy_template_slug)
  END,
  true,
  NULL,
  NULL,
  'active'
FROM agent_target_spaces ats
WHERE ats.space_id IS NOT NULL
ON CONFLICT (tenant_id, space_id, agent_id)
DO NOTHING;

-- Move Template MCP bindings onto the migrated Space that represents that
-- context. The agent-level copy above preserves existing runtime behavior;
-- this Space-level copy is the new contextual source of truth.
WITH template_target_spaces AS (
  SELECT
    t.id AS template_id,
    t.tenant_id,
    CASE
      WHEN t.slug = 'default' THEN default_space.id
      ELSE template_space.id
    END AS space_id
  FROM public.agent_templates t
  JOIN public.spaces default_space
    ON default_space.tenant_id = t.tenant_id
   AND default_space.slug = 'default'
  LEFT JOIN public.spaces template_space
    ON template_space.tenant_id = t.tenant_id
   AND template_space.slug = 'template-' || regexp_replace(lower(t.slug), '[^a-z0-9]+', '-', 'g')
  WHERE t.tenant_id IS NOT NULL
    AND t.template_kind = 'agent'
)
INSERT INTO public.space_mcp_servers (
  tenant_id,
  space_id,
  mcp_server_id,
  enabled,
  config
)
SELECT
  tts.tenant_id,
  tts.space_id,
  atm.mcp_server_id,
  COALESCE(atm.enabled, true),
  COALESCE(atm.config, '{}'::jsonb)
    || jsonb_build_object('source', 'template_migration', 'legacyTemplateId', atm.template_id::text)
FROM template_target_spaces tts
JOIN public.agent_template_mcp_servers atm
  ON atm.template_id = tts.template_id
WHERE tts.space_id IS NOT NULL
ON CONFLICT (space_id, mcp_server_id)
DO NOTHING;

COMMIT;
