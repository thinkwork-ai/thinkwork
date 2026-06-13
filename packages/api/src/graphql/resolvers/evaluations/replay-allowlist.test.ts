/**
 * Read-only MCP replay allowlist resolver tests (Evaluations Trust Core U13).
 *
 * Pins the resolver contract: tenant scoping (incl. Google-federated
 * fallback), operator gating before side effects, row-derived gate on
 * remove, idempotent add, and the available-MCP-tools listing sourced from
 * the cached tenant_mcp_servers.tools discovery list.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  selectQueue,
  insertQueue,
  insertValues,
  deleteWheres,
  mockResolveCallerTenantId,
  mockRequireTenantAdmin,
  resetState,
} = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const insertQueue: unknown[][] = [];
  const insertValues: unknown[] = [];
  const deleteWheres: unknown[] = [];
  return {
    selectQueue,
    insertQueue,
    insertValues,
    deleteWheres,
    mockResolveCallerTenantId: vi.fn(),
    mockRequireTenantAdmin: vi.fn(),
    resetState: () => {
      selectQueue.length = 0;
      insertQueue.length = 0;
      insertValues.length = 0;
      deleteWheres.length = 0;
    },
  };
});

vi.mock("../../utils.js", () => {
  const makeSelectChain = () => {
    const chain: any = {};
    for (const method of ["from", "orderBy", "limit"]) {
      chain[method] = () => chain;
    }
    chain.where = () => chain;
    chain.then = (
      resolve: (rows: unknown[]) => unknown,
      reject: (err: unknown) => unknown,
    ) => Promise.resolve(selectQueue.shift() ?? []).then(resolve, reject);
    return chain;
  };
  return {
    db: {
      select: () => makeSelectChain(),
      insert: () => ({
        values: (vals: unknown) => {
          insertValues.push(vals);
          return {
            returning: () => Promise.resolve(insertQueue.shift() ?? []),
          };
        },
      }),
      delete: () => ({
        where: (clause: unknown) => {
          deleteWheres.push(clause);
          return Promise.resolve([]);
        },
      }),
    },
    eq: (...args: unknown[]) => ({ eq: args }),
    and: (...args: unknown[]) => ({ and: args }),
    tenantMcpServers: {
      tenant_id: "tenant_mcp_servers.tenant_id",
      slug: "tenant_mcp_servers.slug",
      name: "tenant_mcp_servers.name",
      tools: "tenant_mcp_servers.tools",
      status: "tenant_mcp_servers.status",
      enabled: "tenant_mcp_servers.enabled",
    },
    evalReplayToolAllowlist: {
      id: "eval_replay_tool_allowlist.id",
      tenant_id: "eval_replay_tool_allowlist.tenant_id",
      server_name: "eval_replay_tool_allowlist.server_name",
      tool_name: "eval_replay_tool_allowlist.tool_name",
    },
  };
});

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: mockResolveCallerTenantId,
}));

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
}));

import {
  evalReplayAllowlistMutations,
  evalReplayAllowlistQueries,
} from "./replay-allowlist.js";

const adminCtx = { auth: { authType: "cognito", tenantId: "tenant-1" } } as any;
const federatedCtx = { auth: { authType: "cognito", tenantId: null } } as any;
const forbidden = new Error("Tenant admin role required");

const allowRow = {
  id: "allow-1",
  tenant_id: "tenant-1",
  server_name: "lastmile--crm",
  tool_name: "opportunities_list",
  created_at: new Date("2026-06-13T00:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  resetState();
  mockResolveCallerTenantId.mockResolvedValue("tenant-1");
  mockRequireTenantAdmin.mockResolvedValue("admin");
});

describe("evalReplayToolAllowlist query", () => {
  it("returns entries scoped to the caller tenant", async () => {
    selectQueue.push([allowRow]);
    const result = await evalReplayAllowlistQueries.evalReplayToolAllowlist(
      {},
      { tenantId: "tenant-1" },
      adminCtx,
    );
    expect(result).toEqual([
      {
        id: "allow-1",
        tenantId: "tenant-1",
        serverName: "lastmile--crm",
        toolName: "opportunities_list",
        createdAt: allowRow.created_at,
      },
    ]);
  });

  it("returns empty for a foreign tenantId without querying", async () => {
    const result = await evalReplayAllowlistQueries.evalReplayToolAllowlist(
      {},
      { tenantId: "tenant-2" },
      adminCtx,
    );
    expect(result).toEqual([]);
    expect(selectQueue).toHaveLength(0);
  });

  it("resolves a Google-federated caller's tenant via the fallback", async () => {
    selectQueue.push([allowRow]);
    const result = await evalReplayAllowlistQueries.evalReplayToolAllowlist(
      {},
      { tenantId: "tenant-1" },
      federatedCtx,
    );
    expect(mockResolveCallerTenantId).toHaveBeenCalled();
    expect(result).toHaveLength(1);
  });
});

describe("evalReplayAvailableMcpTools query", () => {
  it("lists approved/enabled servers with normalized discovered tools", async () => {
    selectQueue.push([
      {
        slug: "lastmile--crm",
        name: "LastMile CRM",
        tools: [
          { name: "opportunities_list", description: "List opps" },
          { name: "opportunity_create" },
          "search", // string-shaped discovery entry
          { description: "no name — dropped" },
        ],
      },
    ]);
    const result = await evalReplayAllowlistQueries.evalReplayAvailableMcpTools(
      {},
      { tenantId: "tenant-1" },
      adminCtx,
    );
    expect(result).toEqual([
      {
        serverName: "lastmile--crm",
        displayName: "LastMile CRM",
        tools: [
          { name: "opportunities_list", description: "List opps" },
          { name: "opportunity_create", description: null },
          { name: "search", description: null },
        ],
      },
    ]);
  });

  it("returns empty for a foreign tenantId without querying", async () => {
    const result = await evalReplayAllowlistQueries.evalReplayAvailableMcpTools(
      {},
      { tenantId: "tenant-2" },
      adminCtx,
    );
    expect(result).toEqual([]);
    expect(selectQueue).toHaveLength(0);
  });
});

describe("addEvalReplayAllowedTool mutation", () => {
  it("operator-gates before any write", async () => {
    mockRequireTenantAdmin.mockRejectedValueOnce(forbidden);
    await expect(
      evalReplayAllowlistMutations.addEvalReplayAllowedTool(
        {},
        {
          tenantId: "tenant-1",
          serverName: "lastmile--crm",
          toolName: "opportunities_list",
        },
        adminCtx,
      ),
    ).rejects.toThrow(forbidden);
    expect(insertValues).toHaveLength(0);
  });

  it("inserts a new (server, tool) row", async () => {
    selectQueue.push([]); // no existing row
    insertQueue.push([allowRow]);
    const result = await evalReplayAllowlistMutations.addEvalReplayAllowedTool(
      {},
      {
        tenantId: "tenant-1",
        serverName: " lastmile--crm ",
        toolName: " opportunities_list ",
      },
      adminCtx,
    );
    // Trimmed before insert.
    expect(insertValues[0]).toMatchObject({
      tenant_id: "tenant-1",
      server_name: "lastmile--crm",
      tool_name: "opportunities_list",
    });
    expect(result).toMatchObject({
      id: "allow-1",
      serverName: "lastmile--crm",
      toolName: "opportunities_list",
    });
  });

  it("is idempotent: re-adding an existing entry returns it without a second insert", async () => {
    selectQueue.push([allowRow]); // existing row found
    const result = await evalReplayAllowlistMutations.addEvalReplayAllowedTool(
      {},
      {
        tenantId: "tenant-1",
        serverName: "lastmile--crm",
        toolName: "opportunities_list",
      },
      adminCtx,
    );
    expect(insertValues).toHaveLength(0);
    expect(result).toMatchObject({ id: "allow-1" });
  });

  it("rejects empty server or tool names", async () => {
    await expect(
      evalReplayAllowlistMutations.addEvalReplayAllowedTool(
        {},
        { tenantId: "tenant-1", serverName: "  ", toolName: "x" },
        adminCtx,
      ),
    ).rejects.toThrow(/serverName/);
    await expect(
      evalReplayAllowlistMutations.addEvalReplayAllowedTool(
        {},
        { tenantId: "tenant-1", serverName: "x", toolName: "  " },
        adminCtx,
      ),
    ).rejects.toThrow(/toolName/);
  });
});

describe("removeEvalReplayAllowedTool mutation", () => {
  it("row-derives the tenant and gates before delete", async () => {
    selectQueue.push([{ tenant_id: "tenant-1" }]);
    mockRequireTenantAdmin.mockRejectedValueOnce(forbidden);
    await expect(
      evalReplayAllowlistMutations.removeEvalReplayAllowedTool(
        {},
        { id: "allow-1" },
        adminCtx,
      ),
    ).rejects.toThrow(forbidden);
    expect(mockRequireTenantAdmin).toHaveBeenCalledWith(adminCtx, "tenant-1");
    expect(deleteWheres).toHaveLength(0);
  });

  it("deletes after the gate passes", async () => {
    selectQueue.push([{ tenant_id: "tenant-1" }]);
    const result =
      await evalReplayAllowlistMutations.removeEvalReplayAllowedTool(
        {},
        { id: "allow-1" },
        adminCtx,
      );
    expect(mockRequireTenantAdmin).toHaveBeenCalledWith(adminCtx, "tenant-1");
    expect(deleteWheres).toHaveLength(1);
    expect(result).toBe(true);
  });

  it("rejects an unknown id with NOT_FOUND and never gates or deletes", async () => {
    selectQueue.push([]); // no row
    await expect(
      evalReplayAllowlistMutations.removeEvalReplayAllowedTool(
        {},
        { id: "ghost" },
        adminCtx,
      ),
    ).rejects.toThrow(/not found/i);
    expect(mockRequireTenantAdmin).not.toHaveBeenCalled();
    expect(deleteWheres).toHaveLength(0);
  });
});
