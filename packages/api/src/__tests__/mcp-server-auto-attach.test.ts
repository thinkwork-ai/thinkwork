/**
 * Settings → Connectors auto-attach: registering or updating an MCP server
 * through the tenant registry attaches it to the tenant's platform-default
 * agent(s) — no separate Composer assignment step. The attach helper is
 * best-effort and self-guards on approved+enabled, so the handlers call it
 * unconditionally after every registry write; these tests pin the wiring
 * (helper called with the right row) and the best-effort contract (a
 * helper failure never fails the registry write).
 */
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SERVER_ID = "11111111-1111-4111-8111-111111111111";
const NEW_SERVER_ID = "22222222-2222-4222-8222-222222222222";

const { dbState, resetDbState, mockAttach, mockApplyFieldUpdate } = vi.hoisted(
  () => {
    type DbState = {
      selectRows: Array<Record<string, unknown>>;
    };
    const dbState: DbState = { selectRows: [] };
    return {
      dbState,
      resetDbState: () => {
        dbState.selectRows = [];
      },
      mockAttach: vi.fn(async () => undefined),
      mockApplyFieldUpdate: vi.fn(async () => ({ revertedToPending: false })),
    };
  },
);

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
  emitAuditEvent: vi.fn(async () => undefined),
}));

vi.mock("../lib/mcp-server-update.js", () => ({
  applyMcpServerFieldUpdate: mockApplyFieldUpdate,
}));

vi.mock("../lib/capabilities/reconcile-connection-folders.js", () => ({
  attachServerToPlatformDefaultAgents: mockAttach,
  writeConnectionFoldersForAgents: vi.fn(async () => undefined),
  removeConnectionFoldersForAgents: vi.fn(async () => undefined),
  connectionSlugForRegistry: vi.fn(() => "slug"),
}));

vi.mock("@thinkwork/database-pg", () => {
  const selectBuilder = () => ({
    from: () => ({
      where: () => {
        const promise = Promise.resolve(dbState.selectRows) as Promise<
          unknown[]
        > & { limit: (n: number) => Promise<unknown[]> };
        promise.limit = async () => dbState.selectRows;
        return promise;
      },
    }),
  });
  const tx = {
    insert: () => ({
      values: () => ({
        returning: async () => [
          { id: NEW_SERVER_ID, url: "https://mcp.example.com/mcp" },
        ],
      }),
    }),
  };
  return {
    getDb: () => ({
      select: selectBuilder,
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
    tenantMcpServers: table("tenant_mcp_servers", [
      "id",
      "tenant_id",
      "slug",
      "url",
    ]),
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
  SecretsManagerClient: vi.fn(() => ({ send: vi.fn(async () => ({})) })),
  CreateSecretCommand: vi.fn((input) => ({ input })),
  UpdateSecretCommand: vi.fn((input) => ({ input })),
  DeleteSecretCommand: vi.fn((input) => ({ input })),
  GetSecretValueCommand: vi.fn((input) => ({ input })),
  ResourceNotFoundException: class extends Error {},
}));

import { handler } from "../handlers/skills.js";

function makeEvent(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): APIGatewayProxyEventV2 {
  return {
    rawPath: path,
    requestContext: { http: { method } },
    headers: {
      authorization: "Bearer token",
      "x-tenant-slug": "thinkwork",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  } as unknown as APIGatewayProxyEventV2;
}

beforeEach(() => {
  resetDbState();
  vi.clearAllMocks();
  mockApplyFieldUpdate.mockResolvedValue({ revertedToPending: false });
});

describe("POST /api/skills/mcp-servers", () => {
  it("attaches a newly registered server to the platform-default agents", async () => {
    const response = await handler(
      makeEvent("POST", "/api/skills/mcp-servers", {
        name: "company-brain",
        url: "https://mcp.example.com/mcp",
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "{}")).toMatchObject({
      id: NEW_SERVER_ID,
      created: true,
    });
    expect(mockAttach).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      registryServerId: NEW_SERVER_ID,
      signedBy: "plugin-reconciler",
    });
  });

  it("attaches on re-registration of an existing server", async () => {
    dbState.selectRows = [{ id: SERVER_ID }];

    const response = await handler(
      makeEvent("POST", "/api/skills/mcp-servers", {
        name: "company-brain",
        url: "https://mcp.example.com/mcp",
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "{}")).toMatchObject({
      id: SERVER_ID,
      updated: true,
    });
    expect(mockAttach).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      registryServerId: SERVER_ID,
      signedBy: "plugin-reconciler",
    });
  });

  it("keeps returning 200 when the attach helper fails", async () => {
    mockAttach.mockRejectedValueOnce(new Error("S3 down"));

    const response = await handler(
      makeEvent("POST", "/api/skills/mcp-servers", {
        name: "company-brain",
        url: "https://mcp.example.com/mcp",
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "{}")).toMatchObject({ created: true });
  });
});

describe("PUT /api/skills/mcp-servers/:id", () => {
  it("attaches after an enable/update write", async () => {
    dbState.selectRows = [{ id: SERVER_ID }];

    const response = await handler(
      makeEvent("PUT", `/api/skills/mcp-servers/${SERVER_ID}`, {
        enabled: true,
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "{}")).toMatchObject({ ok: true });
    expect(mockApplyFieldUpdate).toHaveBeenCalledTimes(1);
    expect(mockAttach).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      registryServerId: SERVER_ID,
      signedBy: "plugin-reconciler",
    });
  });
});
