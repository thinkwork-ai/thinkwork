import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { tenantMcpServers } from "../src/schema/mcp-servers";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0186 = readFileSync(
  join(HERE, "..", "drizzle", "0186_tenant_mcp_runtime_metadata.sql"),
  "utf-8",
);

describe("migration 0186 - tenant MCP runtime metadata", () => {
  it("adds the nullable runtime metadata column to tenant_mcp_servers", () => {
    const columns = getTableConfig(tenantMcpServers).columns;
    const runtimeMetadataColumn = columns.find(
      (column) => column.name === "runtime_metadata",
    );

    expect(columns.map((column) => column.name)).toContain("runtime_metadata");
    expect(runtimeMetadataColumn?.notNull).toBe(false);
    expect(runtimeMetadataColumn?.hasDefault).toBe(false);
    expect(migration0186).toContain(
      "-- creates-column: public.tenant_mcp_servers.runtime_metadata",
    );
    expect(migration0186).toMatch(
      /ALTER TABLE public\.tenant_mcp_servers\s+ADD COLUMN IF NOT EXISTS runtime_metadata jsonb/i,
    );
    expect(migration0186).not.toMatch(/\bruntime_metadata jsonb\s+NOT NULL\b/i);
    expect(migration0186).not.toMatch(/\bruntime_metadata jsonb\s+DEFAULT\b/i);
  });
});
