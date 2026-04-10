-- Thinkwork Dev Seed Data
-- Run: psql $DATABASE_URL -f scripts/seed-dev.sql

-- Model Catalog (Bedrock models available for agent configuration)
INSERT INTO model_catalog (model_id, provider, display_name, input_cost_per_million, output_cost_per_million, context_window, max_output_tokens, supports_vision, supports_tools) VALUES
  ('us.anthropic.claude-sonnet-4-6', 'anthropic', 'Claude Sonnet 4.6', 3.00, 15.00, 200000, 64000, true, true),
  ('us.anthropic.claude-opus-4-6-v1', 'anthropic', 'Claude Opus 4.6', 15.00, 75.00, 200000, 32000, true, true),
  ('us.anthropic.claude-haiku-4-5-20251001-v1:0', 'anthropic', 'Claude Haiku 4.5', 0.80, 4.00, 200000, 64000, true, true),
  ('moonshotai.kimi-k2.5', 'moonshot', 'Kimi K2.5', 1.00, 4.00, 128000, 8192, false, true),
  ('openai.gpt-oss-20b-1:0', 'openai', 'GPT OSS 20B', 0.50, 2.00, 128000, 16384, false, true),
  ('openai.gpt-oss-120b-1:0', 'openai', 'GPT OSS 120B', 2.00, 8.00, 128000, 16384, false, true)
ON CONFLICT (model_id) DO NOTHING;

-- Connect Providers (OAuth integration templates)
INSERT INTO connect_providers (id, slug, name, type, auth_type, scopes, config) VALUES
  (gen_random_uuid(), 'google-workspace', 'Google Workspace', 'oauth2', 'oauth2', ARRAY['https://www.googleapis.com/auth/gmail.modify','https://www.googleapis.com/auth/calendar','https://www.googleapis.com/auth/calendar.events'], '{"authorize_url":"https://accounts.google.com/o/oauth2/v2/auth","token_url":"https://oauth2.googleapis.com/token","access_type":"offline","prompt":"consent"}'::jsonb),
  (gen_random_uuid(), 'github', 'GitHub', 'oauth2', 'github_app', '{}', '{}'::jsonb),
  (gen_random_uuid(), 'slack', 'Slack', 'oauth2', 'oauth2', ARRAY['chat:write','channels:read','users:read'], '{"authorize_url":"https://slack.com/oauth/v2/authorize","token_url":"https://slack.com/api/oauth.v2.access"}'::jsonb)
ON CONFLICT DO NOTHING;

SELECT 'Seed complete: ' || (SELECT count(*) FROM model_catalog) || ' models, ' || (SELECT count(*) FROM connect_providers) || ' providers' AS result;
