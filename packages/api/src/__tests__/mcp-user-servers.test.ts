import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  dbState,
  resetDbState,
  mockAuthenticate,
  mockRequireTenantMembership,
  mockSecretsSend,
  mockMcpListTools,
} = vi.hoisted(() => {
  type DbState = {
    selectQueue: unknown[][];
    predicates: unknown[];
    updateSets: unknown[];
  };
  const dbState: DbState = {
    selectQueue: [],
    predicates: [],
    updateSets: [],
  };
  return {
    dbState,
    resetDbState: () => {
      dbState.selectQueue = [];
      dbState.predicates = [];
      dbState.updateSets = [];
    },
    mockAuthenticate: vi.fn(() => Promise.resolve({ sub: "principal-1" })),
    mockRequireTenantMembership: vi.fn(() =>
      Promise.resolve({
        ok: true,
        auth: {
          authType: "cognito",
          principalId: "principal-1",
          tenantId: "tenant-1",
          email: "member@example.com",
          emailVerified: true,
          agentId: null,
        },
        tenantId: "tenant-1",
        userId: "user-1",
        role: "member",
      }),
    ),
    mockSecretsSend: vi.fn(async (_command: any) => ({})),
    mockMcpListTools: vi.fn(
      async (): Promise<
        Array<{ name: string; description?: string; inputSchema?: unknown }>
      > => [],
    ),
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
          const rows = Promise.resolve(dbState.selectQueue.shift() ?? []);
          return Object.assign(rows, { limit: () => rows });
        },
        innerJoin: () => ({
          where: (predicate: unknown) => {
            dbState.predicates.push(predicate);
            const rows = Promise.resolve(dbState.selectQueue.shift() ?? []);
            return Object.assign(rows, { limit: () => rows });
          },
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([{ id: "inserted-id" }]),
        onConflictDoUpdate: () => Promise.resolve(),
      }),
    }),
    update: () => ({
      set: (values: unknown) => {
        dbState.updateSets.push(values);
        return { where: () => Promise.resolve() };
      },
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
    tenants: {
      id: col("tenants.id"),
      slug: col("tenants.slug"),
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
    users: {
      id: col("users.id"),
      tenant_id: col("users.tenant_id"),
      cognito_sub: col("users.cognito_sub"),
    },
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
  or: (...args: unknown[]) => ({ _or: args }),
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

vi.mock("../lib/mcp-client-call.js", () => ({
  mcpListTools: mockMcpListTools,
}));

// eslint-disable-next-line import/first
import { handler } from "../handlers/skills.js";

beforeEach(() => {
  resetDbState();
  vi.clearAllMocks();
  mockAuthenticate.mockResolvedValue({ sub: "principal-1" });
  mockRequireTenantMembership.mockResolvedValue({
    ok: true,
    auth: {
      authType: "cognito",
      principalId: "principal-1",
      tenantId: "tenant-1",
      email: "member@example.com",
      emailVerified: true,
      agentId: null,
    },
    tenantId: "tenant-1",
    userId: "user-1",
    role: "member",
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
    dbState.selectQueue.push([], [managedTenantApiKeyRow()]);

    const response = await handler(event());
    const body = JSON.parse(response.body ?? "{}") as { servers: unknown[] };

    expect(response.statusCode).toBe(200);
    expect(body.servers).toEqual([]);
  });

  it("rejects a member caller-supplied principal header for another user", async () => {
    dbState.selectQueue.push(
      [],
      [managedTwentyRow({ mcp_server_id: "twenty" })],
      [{ mcp_server_id: "twenty", status: "active" }],
    );

    const response = await handler(event({ principalId: "cognito-sub-uuid" }));
    const body = JSON.parse(response.body ?? "{}") as { error: string };

    expect(response.statusCode).toBe(403);
    expect(body.error).toBe("Members may only manage their own MCP tokens");
    expect(dbState.predicates).toEqual([]);
  });

  it("resolves raw Cognito sub to users.id before building MCP OAuth state", async () => {
    dbState.selectQueue.push(
      [{ id: "db-user-1" }],
      [
        {
          url: "https://dev-mcp.lastmile-tei.com/crm",
          slug: "lastmile-crm",
          auth_config: {
            authorize_endpoint: "https://auth.example/authorize",
            token_endpoint: "https://auth.example/token",
            client_id: "client-1",
            oauth_resource: "https://dev-mcp.lastmile-tei.com/crm",
          },
        },
      ],
    );

    const response = await handler(
      oauthAuthorizeEvent({ userId: "cognito-sub-uuid" }),
    );
    const location = response.headers?.Location as string;
    const stateParam = new URL(location).searchParams.get("state");
    const state = JSON.parse(
      Buffer.from(stateParam ?? "", "base64url").toString(),
    ) as { userId: string };

    expect(response.statusCode).toBe(302);
    expect(state.userId).toBe("db-user-1");
  });
});

describe("service credential MCP routes", () => {
  it("marks service credential servers connected in the tenant MCP list when their access token is set", async () => {
    dbState.selectQueue.push([{ id: "tenant-1" }], [n8nServiceServerRow()]);
    mockSecretsSend.mockResolvedValue({
      SecretString: JSON.stringify({
        N8N_MCP_SERVICE_CREDENTIAL: "n8n_mcp_token_OMPc",
      }),
    });

    const response = await handler(mcpServerListEvent());
    const body = JSON.parse(response.body ?? "{}") as {
      servers: Array<{ id: string; authStatus?: string }>;
    };

    expect(response.statusCode).toBe(200);
    expect(body.servers).toEqual([
      expect.objectContaining({
        id: "11111111-1111-1111-1111-111111111111",
        authType: "service_credential",
        authStatus: "active",
      }),
    ]);
  });

  it("reports whether the configured service credential secret has a token", async () => {
    dbState.selectQueue.push([{ id: "tenant-1" }], [n8nServiceServerRow()]);
    mockSecretsSend.mockResolvedValue({
      SecretString: JSON.stringify({
        N8N_MCP_SERVICE_CREDENTIAL: "n8n_mcp_token_abc123",
      }),
    });

    const response = await handler(serviceCredentialEvent("GET", "status"));
    const body = JSON.parse(response.body ?? "{}") as {
      hasCredential: boolean;
      lastFour: string | null;
      secretJsonKey: string | null;
    };

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      hasCredential: true,
      lastFour: "c123",
      secretJsonKey: "N8N_MCP_SERVICE_CREDENTIAL",
    });
    expect(mockSecretsSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { SecretId: "arn:aws:secretsmanager:secret:n8n-service" },
      }),
    );
  });

  it("stores a pasted n8n access token without writing it to tenant_mcp_servers", async () => {
    dbState.selectQueue.push([{ id: "tenant-1" }], [n8nServiceServerRow()]);
    mockSecretsSend.mockImplementation(async (command: any) => {
      if (command.input?.SecretString) return {};
      return {
        SecretString: JSON.stringify({
          existingMetadata: "keep-me",
        }),
      };
    });

    const response = await handler(
      serviceCredentialEvent("PUT", "save", {
        token: "Bearer n8n_mcp_token_saved9876",
      }),
    );
    const body = JSON.parse(response.body ?? "{}") as {
      ok: boolean;
      lastFour: string;
    };

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({ ok: true, lastFour: "9876" });
    const updateCall = mockSecretsSend.mock.calls.find(
      ([command]) => command.input?.SecretString,
    );
    expect(updateCall).toBeTruthy();
    const saved = JSON.parse(updateCall![0].input.SecretString);
    expect(saved).toMatchObject({
      existingMetadata: "keep-me",
      type: "mcpServiceCredential",
      credentialKind: "n8n-mcp-access-token",
      N8N_MCP_SERVICE_CREDENTIAL: "n8n_mcp_token_saved9876",
    });
    expect(JSON.stringify(dbState.predicates)).toContain(
      "tenant_mcp_servers.id",
    );
    expect(JSON.stringify(saved)).not.toContain("Bearer ");
  });

  it("rejects service credential tokens with header-injection characters", async () => {
    dbState.selectQueue.push([{ id: "tenant-1" }], [n8nServiceServerRow()]);

    const response = await handler(
      serviceCredentialEvent("PUT", "save", {
        token: "n8n_token\nx-evil: yes",
      }),
    );
    const body = JSON.parse(response.body ?? "{}") as { error: string };

    expect(response.statusCode).toBe(400);
    expect(body.error).toMatch(/newline/);
    expect(mockSecretsSend).not.toHaveBeenCalled();
  });

  it("tests service credential MCP servers with the saved bearer token", async () => {
    dbState.selectQueue.push([{ id: "tenant-1" }], [n8nServiceServerRow()]);
    mockSecretsSend.mockResolvedValue({
      SecretString: JSON.stringify({
        N8N_MCP_SERVICE_CREDENTIAL: "n8n_mcp_token_OMPc",
      }),
    });
    mockMcpListTools.mockResolvedValue([
      {
        name: "search_workflows",
        description: "Search workflows",
        inputSchema: { type: "object" },
      },
    ]);

    const response = await handler(mcpServerTestEvent());
    const body = JSON.parse(response.body ?? "{}") as {
      ok: boolean;
      tools: Array<{ name: string; description?: string }>;
    };

    expect(response.statusCode).toBe(200);
    expect(body).toEqual({
      ok: true,
      tools: [{ name: "search_workflows", description: "Search workflows" }],
    });
    expect(mockMcpListTools).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://n8n.thinkwork.ai/mcp-server/http",
        name: "n8n--workflow-management",
        token: "n8n_mcp_token_OMPc",
      }),
      { timeoutMs: 10000 },
    );
    expect(dbState.updateSets).toContainEqual(
      expect.objectContaining({
        tools: [{ name: "search_workflows", description: "Search workflows" }],
      }),
    );
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

function n8nServiceServerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name: "n8n workflow management",
    slug: "n8n--workflow-management",
    url: "https://n8n.thinkwork.ai/mcp-server/http",
    transport: "streamable_http",
    auth_type: "service_credential",
    oauth_provider: null,
    auth_config: {
      credentialKind: "n8n-mcp-access-token",
      secretRef: "arn:aws:secretsmanager:secret:n8n-service",
      secretRefConfigKey: "serviceCredentialSecretArn",
      headers: [
        {
          name: "Authorization",
          secretJsonKey: "N8N_MCP_SERVICE_CREDENTIAL",
          valuePrefix: "Bearer ",
        },
      ],
    },
    tools: [{ name: "search_workflows" }],
    enabled: true,
    status: "approved",
    url_hash: "url-hash",
    management_source: "plugin",
    managed_application_key: null,
    approved_by: "user-1",
    approved_at: new Date("2026-06-20T00:00:00Z"),
    created_at: new Date("2026-06-20T00:00:00Z"),
    ...overrides,
  };
}

function defaultMembership() {
  return {
    ok: true,
    auth: {
      authType: "cognito",
      principalId: "principal-1",
      tenantId: "tenant-1",
      email: "member@example.com",
      emailVerified: true,
      agentId: null,
    },
    tenantId: "tenant-1",
    userId: "user-1",
    role: "member",
  };
}

function managedTenantApiKeyRow(overrides: Record<string, unknown> = {}) {
  return {
    mcp_server_id: "control-server",
    name: "Control",
    slug: "control-server",
    url: "https://api.thinkwork.test/mcp/control",
    auth_type: "tenant_api_key",
    tools: [{ name: "control_tool" }],
    server_enabled: true,
    management_source: "managed_application",
    managed_application_key: "control-server",
    ...overrides,
  };
}

function event(input: { principalId?: string } = {}): APIGatewayProxyEventV2 {
  return {
    rawPath: "/api/skills/user-mcp-servers",
    requestContext: { http: { method: "GET" } },
    headers: {
      authorization: "Bearer token",
      "x-tenant-id": "tenant-1",
      "x-principal-id": input.principalId ?? "user-1",
    },
  } as unknown as APIGatewayProxyEventV2;
}

function mcpServerListEvent(): APIGatewayProxyEventV2 {
  return {
    rawPath: "/api/skills/mcp-servers",
    requestContext: { http: { method: "GET" } },
    headers: {
      authorization: "Bearer token",
      "x-tenant-slug": "thinkwork",
    },
  } as unknown as APIGatewayProxyEventV2;
}

function serviceCredentialEvent(
  method: "GET" | "PUT",
  kind: "status" | "save",
  body?: Record<string, unknown>,
): APIGatewayProxyEventV2 {
  const suffix =
    kind === "status" ? "service-credential-status" : "service-credential";
  return {
    rawPath: `/api/skills/mcp-servers/11111111-1111-1111-1111-111111111111/${suffix}`,
    requestContext: { http: { method } },
    headers: {
      authorization: "Bearer token",
      "x-tenant-slug": "thinkwork",
    },
    body: body ? JSON.stringify(body) : undefined,
  } as unknown as APIGatewayProxyEventV2;
}

function mcpServerTestEvent(): APIGatewayProxyEventV2 {
  return {
    rawPath:
      "/api/skills/mcp-servers/11111111-1111-1111-1111-111111111111/test",
    requestContext: { http: { method: "POST" } },
    headers: {
      authorization: "Bearer token",
      "x-tenant-slug": "thinkwork",
    },
    body: "{}",
  } as unknown as APIGatewayProxyEventV2;
}

function oauthAuthorizeEvent(input: {
  userId: string;
  tenantId?: string;
  mcpServerId?: string;
}): APIGatewayProxyEventV2 {
  return {
    rawPath: "/api/skills/mcp-oauth/authorize",
    requestContext: { http: { method: "GET" } },
    headers: { host: "api.example" },
    queryStringParameters: {
      mcpServerId: input.mcpServerId ?? "mcp-1",
      userId: input.userId,
      tenantId: input.tenantId ?? "tenant-1",
      returnTo: "http://localhost:5174/settings/mcp-servers/mcp-1",
    },
  } as unknown as APIGatewayProxyEventV2;
}
