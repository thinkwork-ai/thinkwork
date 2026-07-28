-- Brain API keys: display suffix + expiry on tenant_mcp_twin_keys.
-- Hand-rolled (mirrors 0274 convention; not registered in meta/_journal.json).
-- Apply via: psql "$DATABASE_URL" -f drizzle/0281_tenant_mcp_twin_keys_expiry_suffix.sql
-- creates-column: public.tenant_mcp_twin_keys.key_suffix
-- creates-column: public.tenant_mcp_twin_keys.expires_at

ALTER TABLE public.tenant_mcp_twin_keys
  ADD COLUMN IF NOT EXISTS key_suffix text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;
