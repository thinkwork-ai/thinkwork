-- Seed: connect_providers row for LastMile Tasks
--
-- Run once per environment (idempotent via ON CONFLICT on the unique `name`):
--   psql $DATABASE_URL -f scripts/seed-lastmile-provider.sql
--
-- Prerequisites (set before users can connect):
--   env vars: LASTMILE_CLIENT_ID, LASTMILE_CLIENT_SECRET, LASTMILE_WEBHOOK_SECRET,
--             LASTMILE_MCP_BASE_URL, LASTMILE_MCP_SERVICE_KEY

INSERT INTO connect_providers (id, name, display_name, provider_type, auth_type, config, is_available)
VALUES (
  gen_random_uuid(),
  'lastmile',
  'LastMile Tasks',
  'task',
  'oauth2',
  '{
    "authorization_url": "https://clerk.lastmile-tei.com/oauth/authorize",
    "token_url": "https://clerk.lastmile-tei.com/oauth/token",
    "userinfo_url": "https://clerk.lastmile-tei.com/oauth/userinfo",
    "scopes": {}
  }'::jsonb,
  true
)
ON CONFLICT (name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  provider_type = EXCLUDED.provider_type,
  auth_type = EXCLUDED.auth_type,
  is_available = EXCLUDED.is_available;

SELECT id, name, display_name, provider_type, is_available
FROM connect_providers
WHERE name = 'lastmile';
