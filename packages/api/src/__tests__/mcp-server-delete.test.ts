/**
 * THINK-295: DELETE /api/skills/mcp-servers/:id must cascade every table
 * that references tenant_mcp_servers, or the FK violation turns the delete
 * into a 500. Before the fix only agent_mcp_servers was cleared — any
 * server that had ever synced tools (tenant_mcp_context_tools rows) or been
 * authenticated (user_mcp_tokens rows) could never be deleted.
 */
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SERVER_ID = "11111111-1111-4111-8111-111111111111";

const { dbState, resetDbState, mockSecretsSend, mockEmitAuditEvent } =
  vi.hoisted(() => {
    type DbState = {
      ownedRows: Array<{ id: string; url: string }>;
      tokenRows: Array<{ secret_ref: string | null }>;
      deletedTables: string[];
    };
    const dbState: DbState = {
      ownedRows: [],
      tokenRows: [],
      deletedTables: [],
    };
    return {
      dbState,
      resetDbState: () => {
        dbState.ownedRows = [];
        dbState.tokenRows = [];
        dbState.deletedTables = [];
      },
      mockSecretsSend: vi.fn(async (_command: unknown) => ({})),
      mockEmitAuditEvent: vi.fn(async () => undefined),
    };
  });

vi.mock("../lib/cognito-auth.js", () => ({
  authenticate: vi.fn(() => Promise.resolve({ sub: "principal-1" })),
}));

vi.mock("../lib/tenant-membership.js", () => ({
  requireTenantMembership: vi.fn(() =>
    Promise.resolve({
      ok: true,
      tenantId: "tenant-1",
      userId: "user-1",
      role: "admin",
    }),
  ),
}));

vi.mock("../lib/tenants.js", () => ({
  resolveTenantId: vi.fn(() => Promise.resolve("tenant-1")),
}));

vi.mock("../lib/compliance/emit.js", () => ({
  emitAuditEvent: mockEmitAuditEvent,
}));

vi.mock("../lib/mcp/assignment-state.js", () => ({
  snapshotMcpServerAttachment: vi.fn(() => Promise.resolve(null)),
  removeMcpAssignmentFoldersForAgents: vi.fn(() => Promise.resolve()),
}));

vi.mock("@thinkwork/database-pg", () => {
  const tableName = (table: unknown) =>
    (table as { __table: string }).__table ?? "unknown";

  const makeDeleteBuilder = (table: unknown) => ({
    where: (_predicate: unknown) => {
      const name = tableName(table);
      dbState.deletedTables.push(name);
      const rows =
        name === "user_mcp_tokens"
          ? dbState.tokenRows
          : name === "tenant_mcp_servers"
            ? dbState.ownedRows
            : [];
      const promise = Promise.resolve(undefined) as Promise<unknown> & {
        returning: (shape?: unknown) => Promise<unknown[]>;
      };
      promise.returning = async () => rows;
      return promise;
    },
  });

  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => dbState.ownedRows,
        }),
      }),
    }),
    delete: makeDeleteBuilder,
  };

  return {
    getDb: () => ({
      transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    }),
  };
});

vi.mock("@thinkwork/database-pg/schema", () => {
  const table = (name: string, columns: string[]) =>
    Object.fromEntries([
      ["__table", name],
      ...columns.map((column) => [column, { name: `${name}.${column}` }]),
    ]);
  return {
    skillRuns: table("skill_runs", []),
    scheduledJobs: table("scheduled_jobs", []),
    tenantMcpServers: table("tenant_mcp_servers", ["id", "tenant_id", "url"]),
    tenantMcpContextTools: table("tenant_mcp_context_tools", ["mcp_server_id"]),
    tenantMcpAdminKeys: table("tenant_mcp_admin_keys", []),
    agentMcpServers: table("agent_mcp_servers", ["mcp_server_id"]),
    agentTemplateMcpServers: table("agent_template_mcp_servers", [
      "mcp_server_id",
    ]),
    spaceMcpServers: table("space_mcp_servers", ["mcp_server_id"]),
    userMcpTokens: table("user_mcp_tokens", ["mcp_server_id", "secret_ref"]),
    tenantBuiltinTools: table("tenant_builtin_tools", []),
    connections: table("connections", []),
    connectProviders: table("connect_providers", []),
    users: table("users", []),
  };
});

vi.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: vi.fn(() => ({ send: mockSecretsSend })),
  CreateSecretCommand: vi.fn((input) => ({ input })),
  UpdateSecretCommand: vi.fn((input) => ({ input })),
  DeleteSecretCommand: vi.fn((input) => ({ __type: "DeleteSecret", input })),
  GetSecretValueCommand: vi.fn((input) => ({ input })),
  ResourceNotFoundException: class extends Error {},
}));

import { handler } from "../handlers/skills.js";

function deleteEvent(): APIGatewayProxyEventV2 {
  return {
    rawPath: `/api/skills/mcp-servers/${SERVER_ID}`,
    requestContext: { http: { method: "DELETE" } },
    headers: {
      authorization: "Bearer token",
      "x-tenant-slug": "thinkwork",
    },
  } as unknown as APIGatewayProxyEventV2;
}

beforeEach(() => {
  resetDbState();
  vi.clearAllMocks();
});

describe("DELETE /api/skills/mcp-servers/:id", () => {
  it("cascades every referencing table before deleting the server", async () => {
    dbState.ownedRows = [
      { id: SERVER_ID, url: "https://mcp.example.com/data-catalog" },
    ];

    const response = await handler(deleteEvent());

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "{}")).toEqual({
      ok: true,
      deleted: SERVER_ID,
    });

    // All referencing tables must be cleared, and the server row last.
    expect(dbState.deletedTables).toEqual([
      "tenant_mcp_context_tools",
      "user_mcp_tokens",
      "space_mcp_servers",
      "agent_template_mcp_servers",
      "agent_mcp_servers",
      "tenant_mcp_servers",
    ]);
    expect(mockEmitAuditEvent).toHaveBeenCalledTimes(1);
  });

  it("deletes the users' token secrets after commit, best-effort", async () => {
    dbState.ownedRows = [
      { id: SERVER_ID, url: "https://mcp.example.com/data-catalog" },
    ];
    dbState.tokenRows = [
      { secret_ref: "thinkwork/stage/mcp-tokens/user-a/server-1" },
      { secret_ref: null },
      { secret_ref: "thinkwork/stage/mcp-tokens/user-b/server-1" },
    ];

    const response = await handler(deleteEvent());

    expect(response.statusCode).toBe(200);
    const secretDeletes = mockSecretsSend.mock.calls
      .map(([command]) => command as { __type?: string; input?: unknown })
      .filter((command) => command.__type === "DeleteSecret");
    expect(secretDeletes.map((command) => command.input)).toEqual([
      expect.objectContaining({
        SecretId: "thinkwork/stage/mcp-tokens/user-a/server-1",
      }),
      expect.objectContaining({
        SecretId: "thinkwork/stage/mcp-tokens/user-b/server-1",
      }),
    ]);
  });

  it("keeps returning 200 when Secrets Manager cleanup fails", async () => {
    dbState.ownedRows = [
      { id: SERVER_ID, url: "https://mcp.example.com/data-catalog" },
    ];
    dbState.tokenRows = [{ secret_ref: "thinkwork/stage/mcp-tokens/x/y" }];
    mockSecretsSend.mockRejectedValueOnce(new Error("SM down"));

    const response = await handler(deleteEvent());

    expect(response.statusCode).toBe(200);
  });

  it("returns 404 without cascading when the server belongs to another tenant", async () => {
    dbState.ownedRows = [];

    const response = await handler(deleteEvent());

    expect(response.statusCode).toBe(404);
    expect(dbState.deletedTables).toEqual([]);
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });
});
