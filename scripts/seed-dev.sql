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

-- Connect Providers (per-user OAuth integration templates)
--
-- Schema: connect_providers has columns (id, name UNIQUE, display_name,
-- provider_type, auth_type, config jsonb, is_available). The `name` column
-- is the stable lookup key every runtime code path uses
-- (oauth-authorize.ts:57, oauth-callback.ts:114, oauth-token.ts:234).
--
-- `config` is a JSON document read by oauth-authorize/oauth-callback with:
--   authorization_url   — provider's authorize endpoint
--   token_url           — provider's token exchange endpoint
--   userinfo_url        — read during callback to capture native user id
--   scopes              — name→URL dict; mobile passes nothing and we
--                          fall through to Object.values(scopes)
--   extra_params        — optional extra query params on the authorize URL
INSERT INTO connect_providers (name, display_name, provider_type, auth_type, config) VALUES
  ('google_productivity', 'Google Workspace', 'oauth2', 'oauth2', jsonb_build_object(
    'authorization_url', 'https://accounts.google.com/o/oauth2/v2/auth',
    'token_url',         'https://oauth2.googleapis.com/token',
    'userinfo_url',      'https://openidconnect.googleapis.com/v1/userinfo',
    'scopes', jsonb_build_object(
      'gmail',    'https://www.googleapis.com/auth/gmail.modify',
      'calendar', 'https://www.googleapis.com/auth/calendar',
      'identity', 'https://www.googleapis.com/auth/userinfo.email'
    ),
    'extra_params', jsonb_build_object('access_type', 'offline', 'prompt', 'consent')
  )),
  ('microsoft_365', 'Microsoft 365', 'oauth2', 'oauth2', jsonb_build_object(
    'authorization_url', 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    'token_url',         'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    'userinfo_url',      'https://graph.microsoft.com/v1.0/me',
    'scopes', jsonb_build_object(
      'email',          'Mail.ReadWrite',
      'calendar',       'Calendars.ReadWrite',
      'identity',       'User.Read',
      'offline_access', 'offline_access'
    )
  )),
  ('github', 'GitHub', 'oauth2', 'oauth2', jsonb_build_object(
    'authorization_url', 'https://github.com/login/oauth/authorize',
    'token_url',         'https://github.com/login/oauth/access_token',
    'userinfo_url',      'https://api.github.com/user',
    'scopes', jsonb_build_object(
      'repo',     'repo',
      'org',      'read:org',
      'identity', 'user:email'
    )
  )),
  ('slack', 'Slack', 'oauth2', 'oauth2', jsonb_build_object(
    'authorization_url', 'https://slack.com/oauth/v2/authorize',
    'token_url',         'https://slack.com/api/oauth.v2.access',
    'userinfo_url',      'https://slack.com/api/users.identity',
    'scopes', jsonb_build_object(
      'chat',     'chat:write',
      'channels', 'channels:read',
      'users',    'users:read'
    )
  ))
ON CONFLICT (name) DO UPDATE SET
  display_name  = EXCLUDED.display_name,
  provider_type = EXCLUDED.provider_type,
  auth_type     = EXCLUDED.auth_type,
  config        = EXCLUDED.config,
  updated_at    = NOW();

SELECT 'Seed complete: ' || (SELECT count(*) FROM model_catalog) || ' models, ' || (SELECT count(*) FROM connect_providers) || ' providers' AS result;
