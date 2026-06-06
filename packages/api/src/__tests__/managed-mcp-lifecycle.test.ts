import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { tenantMcpServers } from "@thinkwork/database-pg/schema";

const migrationSql = readFileSync(
  new URL(
    "../../../database-pg/drizzle/0149_managed_mcp_servers.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("managed MCP lifecycle schema", () => {
  it("exports first-class ownership columns for managed application rows", () => {
    expect(tenantMcpServers.management_source.name).toBe("management_source");
    expect(tenantMcpServers.managed_application_key.name).toBe(
      "managed_application_key",
    );
  });

  it("keeps existing manual MCP rows manual by default", () => {
    expect(migrationSql).toContain(
      "ADD COLUMN IF NOT EXISTS management_source text NOT NULL DEFAULT 'manual'",
    );
    expect(migrationSql).toContain(
      "ADD COLUMN IF NOT EXISTS managed_application_key text",
    );
  });

  it("requires managed application rows to carry a managed application key", () => {
    expect(migrationSql).toContain(
      "tenant_mcp_servers_managed_application_shape_check",
    );
    expect(migrationSql).toContain(
      "(management_source = 'manual' AND managed_application_key IS NULL)",
    );
    expect(migrationSql).toContain(
      "(management_source = 'managed_application' AND managed_application_key IS NOT NULL)",
    );
  });

  it("prevents duplicate managed rows for the same tenant and application", () => {
    expect(migrationSql).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_mcp_servers_managed_application",
    );
    expect(migrationSql).toContain(
      "ON public.tenant_mcp_servers (tenant_id, managed_application_key)",
    );
    expect(migrationSql).toContain("WHERE managed_application_key IS NOT NULL");
  });
});
