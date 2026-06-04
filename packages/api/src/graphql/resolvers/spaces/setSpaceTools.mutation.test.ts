import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  selectQueue,
  deleteTables,
  insertValues,
  updateSets,
  authCalls,
  resetMocks,
} = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const deleteTables: unknown[] = [];
  const insertValues: unknown[] = [];
  const updateSets: Record<string, unknown>[] = [];
  const authCalls: unknown[] = [];
  return {
    selectQueue,
    deleteTables,
    insertValues,
    updateSets,
    authCalls,
    resetMocks: () => {
      selectQueue.length = 0;
      deleteTables.length = 0;
      insertValues.length = 0;
      updateSets.length = 0;
      authCalls.length = 0;
    },
  };
});

vi.mock("../../utils.js", () => {
  const col = (name: string) => ({ name });
  const selectChain = {
    from: () => ({
      where: () => Promise.resolve(selectQueue.shift() ?? []),
    }),
  };
  const tx = {
    delete: (table: unknown) => {
      deleteTables.push(table);
      return {
        where: () => Promise.resolve(),
      };
    },
    insert: () => ({
      values: (values: Record<string, unknown>[]) => {
        insertValues.push(values);
        return Promise.resolve();
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updateSets.push(values);
        return {
          where: () => ({
            returning: () =>
              Promise.resolve([
                {
                  id: "space-1",
                  tenant_id: "tenant-1",
                  name: "Customer Onboarding",
                  tool_policy: values.tool_policy,
                  mcp_policy: values.mcp_policy,
                },
              ]),
          }),
        };
      },
    }),
  };

  return {
    spaceMcpServers: {
      tenant_id: col("space_mcp_servers.tenant_id"),
      space_id: col("space_mcp_servers.space_id"),
    },
    spaces: {
      id: col("spaces.id"),
      tenant_id: col("spaces.tenant_id"),
      tool_policy: col("spaces.tool_policy"),
      mcp_policy: col("spaces.mcp_policy"),
    },
    tenantMcpServers: {
      id: col("tenant_mcp_servers.id"),
      tenant_id: col("tenant_mcp_servers.tenant_id"),
      slug: col("tenant_mcp_servers.slug"),
    },
    db: {
      select: () => selectChain,
      transaction: async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx),
    },
    and: (...items: unknown[]) => ({ and: items }),
    eq: (left: unknown, right: unknown) => ({ eq: [left, right] }),
    inArray: (left: unknown, right: unknown) => ({ inArray: [left, right] }),
    snakeToCamel: (row: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key.replace(/_([a-z])/g, (_, char) => char.toUpperCase()),
          value,
        ]),
      ),
  };
});

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: (...args: unknown[]) => {
    authCalls.push(args);
    return Promise.resolve();
  },
}));

describe("setSpaceTools", () => {
  beforeEach(() => {
    resetMocks();
    vi.resetModules();
  });

  it("replaces built-in tool and MCP selections for a Space", async () => {
    selectQueue.push(
      [
        {
          id: "space-1",
          tool_policy: { blockedTools: ["send_email"] },
          mcp_policy: { blockedServers: ["prod-db"] },
        },
      ],
      [
        { id: "mcp-2", slug: "linear" },
        { id: "mcp-1", slug: "github" },
      ],
    );
    const { setSpaceTools } = await import("./setSpaceTools.mutation.js");

    const result = await setSpaceTools(
      null,
      {
        input: {
          tenantId: "tenant-1",
          spaceId: "space-1",
          builtInToolSlugs: ["web-search", "web-extract", "web-search"],
          mcpServerIds: ["mcp-2", "mcp-1"],
        },
      },
      { auth: { authType: "cognito" } } as any,
    );

    expect(authCalls[0]).toEqual([
      { auth: { authType: "cognito" } },
      "tenant-1",
      "set_space_tools",
    ]);
    expect(deleteTables).toHaveLength(1);
    expect(insertValues[0]).toEqual([
      {
        tenant_id: "tenant-1",
        space_id: "space-1",
        mcp_server_id: "mcp-2",
        enabled: true,
        config: null,
      },
      {
        tenant_id: "tenant-1",
        space_id: "space-1",
        mcp_server_id: "mcp-1",
        enabled: true,
        config: null,
      },
    ]);
    expect(updateSets[0]).toEqual(
      expect.objectContaining({
        tool_policy: {
          blockedTools: ["send_email"],
          builtInTools: ["web-extract", "web-search"],
          allowedTools: ["web-extract", "web-search"],
        },
        mcp_policy: {
          blockedServers: ["prod-db"],
          allowedServers: ["linear", "github"],
        },
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: "space-1",
        tenantId: "tenant-1",
        toolPolicy: expect.objectContaining({
          builtInTools: ["web-extract", "web-search"],
        }),
      }),
    );
  });

  it("allows clearing MCP assignments without clearing built-in tools", async () => {
    selectQueue.push([
      {
        id: "space-1",
        tool_policy: {},
        mcp_policy: {},
      },
    ]);
    const { setSpaceTools } = await import("./setSpaceTools.mutation.js");

    await setSpaceTools(
      null,
      {
        input: {
          tenantId: "tenant-1",
          spaceId: "space-1",
          builtInToolSlugs: ["agent-email-send"],
          mcpServerIds: [],
        },
      },
      { auth: { authType: "cognito" } } as any,
    );

    expect(deleteTables).toHaveLength(1);
    expect(insertValues).toHaveLength(0);
    expect(updateSets[0]).toEqual(
      expect.objectContaining({
        tool_policy: expect.objectContaining({
          builtInTools: ["agent-email-send"],
        }),
        mcp_policy: expect.objectContaining({ allowedServers: [] }),
      }),
    );
  });

  it("rejects unknown built-in tool slugs before writing", async () => {
    const { setSpaceTools } = await import("./setSpaceTools.mutation.js");

    await expect(
      setSpaceTools(
        null,
        {
          input: {
            tenantId: "tenant-1",
            spaceId: "space-1",
            builtInToolSlugs: ["not-a-tool"],
            mcpServerIds: [],
          },
        },
        { auth: { authType: "cognito" } } as any,
      ),
    ).rejects.toThrow("Unknown built-in tool 'not-a-tool'");

    expect(deleteTables).toHaveLength(0);
    expect(updateSets).toHaveLength(0);
  });

  it("rejects missing or cross-tenant MCP servers before writing", async () => {
    selectQueue.push(
      [{ id: "space-1", tool_policy: {}, mcp_policy: {} }],
      [{ id: "mcp-1", slug: "github" }],
    );
    const { setSpaceTools } = await import("./setSpaceTools.mutation.js");

    await expect(
      setSpaceTools(
        null,
        {
          input: {
            tenantId: "tenant-1",
            spaceId: "space-1",
            builtInToolSlugs: [],
            mcpServerIds: ["mcp-1", "other-tenant-mcp"],
          },
        },
        { auth: { authType: "cognito" } } as any,
      ),
    ).rejects.toThrow("MCP server not found for tenant");

    expect(deleteTables).toHaveLength(0);
    expect(updateSets).toHaveLength(0);
  });
});
