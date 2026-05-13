-- creates: public.view_default_template_models_updated_0086
--
-- Move seeded platform/default templates off the dated Sonnet inference
-- profile that now fails Bedrock runtime access in dev AgentCore.
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0086_update_default_template_models.sql

UPDATE agent_templates
   SET model = 'us.anthropic.claude-sonnet-4-6',
       updated_at = now()
 WHERE slug IN ('thinkwork-computer-default', 'default')
   AND model = 'us.anthropic.claude-sonnet-4-20250514-v1:0';

CREATE OR REPLACE VIEW public.view_default_template_models_updated_0086 AS
SELECT id, slug, template_kind, source, model
  FROM agent_templates
 WHERE slug IN ('thinkwork-computer-default', 'default')
   AND model = 'us.anthropic.claude-sonnet-4-6';
