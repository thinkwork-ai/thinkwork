import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSelectLimit, mockUpdateSet, mockInsertValues } = vi.hoisted(() => ({
  mockSelectLimit: vi.fn(),
  mockUpdateSet: vi.fn(),
  mockInsertValues: vi.fn(),
}));

vi.mock("./db.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(mockSelectLimit() as unknown[]),
        }),
      }),
    }),
    update: () => ({
      set: (values: unknown) => ({
        where: () => {
          mockUpdateSet(values);
          return Promise.resolve();
        },
      }),
    }),
    insert: () => ({
      values: (values: unknown) => ({
        onConflictDoUpdate: () => {
          mockInsertValues(values);
          return Promise.resolve();
        },
      }),
    }),
  },
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  tenantMcpServers: {
    id: "tenant_mcp_servers.id",
    tenant_id: "tenant_mcp_servers.tenant_id",
    slug: "tenant_mcp_servers.slug",
    name: "tenant_mcp_servers.name",
  },
  tenantMcpContextTools: {
    tenant_id: "tenant_mcp_context_tools.tenant_id",
    mcp_server_id: "tenant_mcp_context_tools.mcp_server_id",
    tool_name: "tenant_mcp_context_tools.tool_name",
  },
}));

import { cacheDiscoveredMcpTools } from "./mcp-tool-cache.js";

beforeEach(() => {
  mockSelectLimit.mockReset();
  mockUpdateSet.mockReset();
  mockInsertValues.mockReset();
});

describe("cacheDiscoveredMcpTools", () => {
  it("writes the tools cache + eligibility rows when resolving by config name", async () => {
    mockSelectLimit.mockReturnValue([{ id: "srv-1" }]);

    const written = await cacheDiscoveredMcpTools({
      tenantId: "t1",
      serverConfigName: "twenty--crm",
      defs: [
        { name: "list_object_metadata_names", description: "List objects" },
        { name: "learn_tools" },
      ],
    });

    expect(written).toBe(true);
    expect(mockUpdateSet).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet.mock.calls[0][0]).toMatchObject({
      tools: [
        { name: "list_object_metadata_names", description: "List objects" },
        { name: "learn_tools" },
      ],
    });
    // One eligibility upsert per discovered tool.
    expect(mockInsertValues).toHaveBeenCalledTimes(2);
    expect(mockInsertValues.mock.calls[0][0]).toMatchObject({
      tenant_id: "t1",
      mcp_server_id: "srv-1",
      tool_name: "list_object_metadata_names",
    });
  });

  it("uses a provided serverId without a lookup", async () => {
    const written = await cacheDiscoveredMcpTools({
      tenantId: "t1",
      serverId: "srv-9",
      defs: [{ name: "orders_list" }],
    });
    expect(written).toBe(true);
    expect(mockSelectLimit).not.toHaveBeenCalled();
    expect(mockUpdateSet).toHaveBeenCalledTimes(1);
  });

  it("no-ops on empty discovery or unresolvable server", async () => {
    expect(
      await cacheDiscoveredMcpTools({
        tenantId: "t1",
        serverConfigName: "x",
        defs: [],
      }),
    ).toBe(false);

    mockSelectLimit.mockReturnValue([]);
    expect(
      await cacheDiscoveredMcpTools({
        tenantId: "t1",
        serverConfigName: "ghost",
        defs: [{ name: "a" }],
      }),
    ).toBe(false);
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });

  it("swallows DB failures — cache maintenance never fails the request", async () => {
    mockSelectLimit.mockImplementation(() => {
      throw new Error("db down");
    });
    const written = await cacheDiscoveredMcpTools({
      tenantId: "t1",
      serverConfigName: "twenty--crm",
      defs: [{ name: "a" }],
    });
    expect(written).toBe(false);
  });
});
