-- Thinkwork Dev Seed Data
-- Run: psql $DATABASE_URL -f scripts/seed-dev.sql

-- Model Catalog (Bedrock models available for agent configuration)
INSERT INTO model_catalog (model_id, provider, display_name, input_cost_per_million, output_cost_per_million, context_window, max_output_tokens, supports_vision, supports_tools) VALUES
  ('us.anthropic.claude-sonnet-4-20250514-v1:0', 'anthropic', 'Claude Sonnet 4', 3.00, 15.00, 200000, 64000, true, true),
  ('us.anthropic.claude-haiku-4-5-20251001-v1:0', 'anthropic', 'Claude Haiku 4.5', 0.80, 4.00, 200000, 64000, true, true),
  ('us.anthropic.claude-opus-4-20250514-v1:0', 'anthropic', 'Claude Opus 4', 15.00, 75.00, 200000, 32000, true, true),
  ('us.amazon.nova-pro-v1:0', 'amazon', 'Amazon Nova Pro', 0.80, 3.20, 300000, 5000, true, true),
  ('us.amazon.nova-lite-v1:0', 'amazon', 'Amazon Nova Lite', 0.06, 0.24, 300000, 5000, true, true),
  ('us.amazon.nova-micro-v1:0', 'amazon', 'Amazon Nova Micro', 0.035, 0.14, 128000, 5000, false, true),
  ('us.meta.llama3-3-70b-instruct-v1:0', 'meta', 'Llama 3.3 70B', 0.72, 0.72, 128000, 4096, false, true),
  ('us.deepseek.r1-v1:0', 'deepseek', 'DeepSeek R1', 1.35, 5.40, 128000, 8192, false, true)
ON CONFLICT (model_id) DO NOTHING;

-- Connect Providers (OAuth integration templates)
INSERT INTO connect_providers (id, slug, name, type, auth_type, scopes, config) VALUES
  (gen_random_uuid(), 'google-workspace', 'Google Workspace', 'oauth2', 'oauth2', ARRAY['https://www.googleapis.com/auth/gmail.modify','https://www.googleapis.com/auth/calendar','https://www.googleapis.com/auth/calendar.events'], '{"authorize_url":"https://accounts.google.com/o/oauth2/v2/auth","token_url":"https://oauth2.googleapis.com/token","access_type":"offline","prompt":"consent"}'::jsonb),
  (gen_random_uuid(), 'github', 'GitHub', 'oauth2', 'github_app', '{}', '{}'::jsonb),
  (gen_random_uuid(), 'slack', 'Slack', 'oauth2', 'oauth2', ARRAY['chat:write','channels:read','users:read'], '{"authorize_url":"https://slack.com/oauth/v2/authorize","token_url":"https://slack.com/api/oauth.v2.access"}'::jsonb)
ON CONFLICT DO NOTHING;

SELECT 'Seed complete: ' || (SELECT count(*) FROM model_catalog) || ' models, ' || (SELECT count(*) FROM connect_providers) || ' providers' AS result;
