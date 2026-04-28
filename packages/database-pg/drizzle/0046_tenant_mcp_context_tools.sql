-- creates: public.tenant_mcp_context_tools
CREATE TABLE IF NOT EXISTS "tenant_mcp_context_tools" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "mcp_server_id" uuid NOT NULL REFERENCES "tenant_mcp_servers"("id"),
  "tool_name" text NOT NULL,
  "display_name" text,
  "declared_read_only" boolean NOT NULL DEFAULT false,
  "declared_search_safe" boolean NOT NULL DEFAULT false,
  "approved" boolean NOT NULL DEFAULT false,
  "default_enabled" boolean NOT NULL DEFAULT false,
  "approved_by" uuid,
  "approved_at" timestamp with time zone,
  "metadata" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_tenant_mcp_context_tools_tool"
  ON "tenant_mcp_context_tools" ("tenant_id", "mcp_server_id", "tool_name");

CREATE INDEX IF NOT EXISTS "idx_tenant_mcp_context_tools_tenant"
  ON "tenant_mcp_context_tools" ("tenant_id");

CREATE INDEX IF NOT EXISTS "idx_tenant_mcp_context_tools_server"
  ON "tenant_mcp_context_tools" ("mcp_server_id");
