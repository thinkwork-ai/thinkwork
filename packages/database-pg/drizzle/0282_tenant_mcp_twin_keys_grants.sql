-- Brain API keys: per-key grants (security groups + KB collections) on
-- tenant_mcp_twin_keys — the write side of key manifest v2
-- (twin-mcp-keys/v2; reader is company-brain brain-mcp/src/auth.ts).
-- Hand-rolled (mirrors 0274/0281 convention; not registered in
-- meta/_journal.json).
-- Apply via: psql "$DATABASE_URL" -f drizzle/0282_tenant_mcp_twin_keys_grants.sql
-- creates-column: public.tenant_mcp_twin_keys.security_groups
-- creates-column: public.tenant_mcp_twin_keys.kb_collections

ALTER TABLE public.tenant_mcp_twin_keys
  ADD COLUMN IF NOT EXISTS security_groups text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS kb_collections text[] NOT NULL DEFAULT ARRAY[]::text[];

-- The platform-provisioned connector key ("default") backs the console
-- proxy and must never be narrowed by this migration: grandfather every
-- active one to the wildcard grant that re-provisioning would write
-- anyway. User-minted keys stay empty = PUBLIC graph only, no KB.
UPDATE public.tenant_mcp_twin_keys
   SET security_groups = ARRAY['*']::text[],
       kb_collections  = ARRAY['*']::text[]
 WHERE name = 'default'
   AND revoked_at IS NULL
   AND security_groups = ARRAY[]::text[]
   AND kb_collections = ARRAY[]::text[];
