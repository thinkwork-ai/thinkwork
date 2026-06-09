import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  dbState,
  resetDbState,
  mockAuthenticate,
  mockRequireTenantMembership,
  mockSecretsSend,
} = vi.hoisted(() => {
  type DbState = {
    selectQueue: unknown[][];
    predicates: unknown[];
  };
  const dbState: DbState = {
    selectQueue: [],
    predicates: [],
  };
  return {
    dbState,
    resetDbState: () => {
      dbState.selectQueue = [];
      dbState.predicates = [];
    },
    mockAuthenticate: vi.fn(() => Promise.resolve({ sub: "principal-1" })),
    mockRequireTenantMembership: vi.fn(() =>
      Promise.resolve({ ok: true, tenantId: "tenant-1", userId: "user-1" }),
    ),
    mockSecretsSend: vi.fn(() => Promise.resolve({})),
  };
});

vi.mock("../lib/cognito-auth.js", () => ({
  authenticate: mockAuthenticate,
}));

vi.mock("../lib/tenant-membership.js", () => ({
  requireTenantMembership: mockRequireTenantMembership,
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: (predicate: unknown) => {
          dbState.predicates.push(predicate);
          return Promise.resolve(dbState.selectQueue.shift() ?? []);
        },
        innerJoin: () => ({
          where: (predicate: unknown) => {
            dbState.predicates.push(predicate);
            return Promise.resolve(dbState.selectQueue.shift() ?? []);
          },
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([{ id: "inserted-id" }]),
      }),
    }),
    update: () => ({
      set: () => ({ where: () => Promise.resolve() }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
    transaction: (fn: (tx: unknown) => unknown) => fn({}),
  }),
}));

vi.mock("@thinkwork/database-pg/schema", () => {
  const col = (name: string) => ({ name });
  return {
    agentSkills: {},
    skillRuns: {},
    tenantMcpServers: {
      id: col("tenant_mcp_servers.id"),
      tenant_id: col("tenant_mcp_servers.tenant_id"),
      name: col("tenant_mcp_servers.name"),
      slug: col("tenant_mcp_servers.slug"),
      url: col("tenant_mcp_servers.url"),
      transport: col("tenant_mcp_servers.transport"),
      auth_type: col("tenant_mcp_servers.auth_type"),
      auth_config: col("tenant_mcp_servers.auth_config"),
      tools: col("tenant_mcp_servers.tools"),
      enabled: col("tenant_mcp_servers.enabled"),
      status: col("tenant_mcp_servers.status"),
      management_source: col("tenant_mcp_servers.management_source"),
      managed_application_key: col(
        "tenant_mcp_servers.managed_application_key",
      ),
      url_hash: col("tenant_mcp_servers.url_hash"),
    },
    tenantMcpContextTools: {},
    tenantMcpAdminKeys: {},
    agentMcpServers: {
      id: col("agent_mcp_servers.id"),
      agent_id: col("agent_mcp_servers.agent_id"),
      mcp_server_id: col("agent_mcp_servers.mcp_server_id"),
      enabled: col("agent_mcp_servers.enabled"),
      config: col("agent_mcp_servers.config"),
    },
    agentTemplateMcpServers: {},
    tenantBuiltinTools: {},
    connections: {},
    connectProviders: {},
    users: {},
    agents: {
      id: col("agents.id"),
      name: col("agents.name"),
      tenant_id: col("agents.tenant_id"),
      human_pair_id: col("agents.human_pair_id"),
    },
    userMcpTokens: {
      mcp_server_id: col("user_mcp_tokens.mcp_server_id"),
      status: col("user_mcp_tokens.status"),
      user_id: col("user_mcp_tokens.user_id"),
      tenant_id: col("user_mcp_tokens.tenant_id"),
    },
    auditOutbox: {},
    COMPLIANCE_EVENT_TYPES: [],
    COMPLIANCE_ACTOR_TYPES: [],
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ _and: args }),
  eq: (...args: unknown[]) => ({ _eq: args }),
  inArray: (...args: unknown[]) => ({ _inArray: args }),
  isNull: (...args: unknown[]) => ({ _isNull: args }),
  sql: (...args: unknown[]) => ({ _sql: args }),
}));

vi.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: vi.fn(() => ({ send: mockSecretsSend })),
  CreateSecretCommand: vi.fn((input) => ({ input })),
  UpdateSecretCommand: vi.fn((input) => ({ input })),
  DeleteSecretCommand: vi.fn((input) => ({ input })),
  GetSecretValueCommand: vi.fn((input) => ({ input })),
  ResourceNotFoundException: class ResourceNotFoundException extends Error {},
}));

// eslint-disable-next-line import/first
import { handler } from "../handlers/skills.js";

beforeEach(() => {
  resetDbState();
  vi.clearAllMocks();
  mockAuthenticate.mockResolvedValue({ sub: "principal-1" });
  mockRequireTenantMembership.mockResolvedValue({
    ok: true,
    tenantId: "tenant-1",
    userId: "user-1",
  });
});

describe("GET /api/skills/user-mcp-servers", () => {
  it("includes enabled managed OAuth servers even before the user has paired agents", async () => {
    dbState.selectQueue.push(
      [],
      [
        managedTwentyRow({
          mcp_server_id: "twenty",
          server_enabled: true,
        }),
      ],
      [],
    );

    const response = await handler(event());
    const body = JSON.parse(response.body ?? "{}") as { servers: unknown[] };

    expect(response.statusCode).toBe(200);
    expect(body.servers).toEqual([
      expect.objectContaining({
        id: "twenty",
        name: "Twenty CRM",
        authType: "oauth",
        authStatus: "not_connected",
        enabled: true,
        runtimeAssigned: false,
        runtimeEnabled: false,
        managementSource: "managed_application",
        managedApplicationKey: "twenty-crm",
      }),
    ]);
  });

  it("reports active once the current user has a stored token", async () => {
    dbState.selectQueue.push(
      [],
      [managedTwentyRow({ mcp_server_id: "twenty" })],
      [{ mcp_server_id: "twenty", status: "active" }],
    );

    const response = await handler(event());
    const body = JSON.parse(response.body ?? "{}") as {
      servers: Array<{ authStatus: string }>;
    };

    expect(response.statusCode).toBe(200);
    expect(body.servers[0]?.authStatus).toBe("active");
    expect(JSON.stringify(dbState.predicates)).toContain(
      "user_mcp_tokens.mcp_server_id",
    );
  });

  it("does not expose managed tenant API key servers as user-auth connectors without an agent assignment", async () => {
    dbState.selectQueue.push([], [managedKestraRow()]);

    const response = await handler(event());
    const body = JSON.parse(response.body ?? "{}") as { servers: unknown[] };

    expect(response.statusCode).toBe(200);
    expect(body.servers).toEqual([]);
  });
});

function managedTwentyRow(overrides: Record<string, unknown> = {}) {
  return {
    mcp_server_id: "twenty",
    name: "Twenty CRM",
    slug: "twenty-crm",
    url: "https://crm.thinkwork.ai/mcp",
    auth_type: "oauth",
    tools: [{ name: "opportunities.list" }],
    server_enabled: true,
    management_source: "managed_application",
    managed_application_key: "twenty-crm",
    ...overrides,
  };
}

function managedKestraRow(overrides: Record<string, unknown> = {}) {
  return {
    mcp_server_id: "kestra",
    name: "Kestra",
    slug: "kestra-control",
    url: "https://api.thinkwork.test/mcp/kestra",
    auth_type: "tenant_api_key",
    tools: [{ name: "kestra_flows_upsert" }],
    server_enabled: true,
    management_source: "managed_application",
    managed_application_key: "kestra",
    ...overrides,
  };
}

function event(): APIGatewayProxyEventV2 {
  return {
    rawPath: "/api/skills/user-mcp-servers",
    requestContext: { http: { method: "GET" } },
    headers: {
      authorization: "Bearer token",
      "x-tenant-id": "tenant-1",
      "x-principal-id": "user-1",
    },
  } as unknown as APIGatewayProxyEventV2;
}
