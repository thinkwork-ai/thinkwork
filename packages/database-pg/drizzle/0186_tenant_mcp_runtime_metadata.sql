-- Purpose: Store non-secret runtime metadata for MCP dispatch without mixing
--          plugin-provided link hints into auth_config or approval hashes.
--
-- creates-column: public.tenant_mcp_servers.runtime_metadata

ALTER TABLE public.tenant_mcp_servers
  ADD COLUMN IF NOT EXISTS runtime_metadata jsonb;

COMMENT ON COLUMN public.tenant_mcp_servers.runtime_metadata IS
  'Non-secret runtime metadata for MCP dispatch, such as plugin record-link hints.';
