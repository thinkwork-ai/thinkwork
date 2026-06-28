/**
 * buildMcpConfigs approval-gate tests (plan §U11).
 *
 * The runtime must only see MCP servers whose `status='approved' AND
 * enabled=true` AND whose stored `url_hash` still matches the current
 * (url, auth_config) tuple. The SQL WHERE already filters status +
 * enabled; the defensive in-code check catches drift (e.g. someone
 * bypasses `applyMcpServerFieldUpdate` and writes raw SQL).
 *
 * Existing grandfathered rows (pre-migration, `url_hash IS NULL`) are
 * allowed — the U3 migration deliberately defaulted `status='approved'`
 * to avoid disrupting live integrations during rollout.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockWhereSelector,
  mockRowsForAgent,
  mockRowsForJoin,
  mockRowsForAssignments,
  mockRowsForUserToken,
  mockSecretString,
} = vi.hoisted(() => ({
  mockWhereSelector: vi.fn(),
  mockRowsForAgent: vi.fn(),
  mockRowsForJoin: vi.fn(),
  mockRowsForAssignments: vi.fn(),
  mockRowsForUserToken: vi.fn(),
  mockSecretString: vi.fn(),
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: () => ({
      from: (table: unknown) => ({
        where: (pred: unknown) => {
          mockWhereSelector(pred);
          const tableRecord =
            table && typeof table === "object"
              ? (table as Record<string, unknown>)
              : {};
          if (tableRecord.id === "agents.id") {
            return {
              limit: () => Promise.resolve(mockRowsForAgent()),
            };
          }
          if (tableRecord.id === "tenantMcpServers.id") {
            return Promise.resolve(mockRowsForJoin());
          }
          if (tableRecord.mcp_server_id === "agentMcpServers.mcp_server_id") {
            return Promise.resolve(mockRowsForAssignments());
          }
          return {
            limit: () => Promise.resolve(mockRowsForUserToken()),
          };
        },
        innerJoin: () => ({
          where: (pred: unknown) => {
            mockWhereSelector(pred);
            return Promise.resolve(mockRowsForJoin());
          },
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  }),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  tenantMcpServers: {
    id: "tenantMcpServers.id",
    name: "tenantMcpServers.name",
    slug: "tenantMcpServers.slug",
    url: "tenantMcpServers.url",
    transport: "tenantMcpServers.transport",
    auth_type: "tenantMcpServers.auth_type",
    auth_config: "tenantMcpServers.auth_config",
    tools: "tenantMcpServers.tools",
    enabled: "tenantMcpServers.enabled",
    status: "tenantMcpServers.status",
    url_hash: "tenantMcpServers.url_hash",
    management_source: "tenantMcpServers.management_source",
    plugin_install_id: "tenantMcpServers.plugin_install_id",
    runtime_metadata: "tenantMcpServers.runtime_metadata",
  },
  agents: {
    id: "agents.id",
    tenant_id: "agents.tenant_id",
  },
  agentMcpServers: {
    mcp_server_id: "agentMcpServers.mcp_server_id",
    agent_id: "agentMcpServers.agent_id",
    enabled: "agentMcpServers.enabled",
    config: "agentMcpServers.config",
  },
  userMcpTokens: {
    user_id: "userMcpTokens.user_id",
    mcp_server_id: "userMcpTokens.mcp_server_id",
    status: "userMcpTokens.status",
    id: "userMcpTokens.id",
    secret_ref: "userMcpTokens.secret_ref",
    expires_at: "userMcpTokens.expires_at",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ _and: args }),
  eq: (col: unknown, val: unknown) => ({ _eq: [col, val] }),
}));

vi.mock("@aws-sdk/client-secrets-manager", () => {
  class Stub {
    async send() {
      return { SecretString: mockSecretString() };
    }
  }
  return {
    SecretsManagerClient: Stub,
    GetSecretValueCommand: class {},
    UpdateSecretCommand: class {},
  };
});

// eslint-disable-next-line import/first
import { buildMcpConfigs } from "../mcp-configs.js";
// eslint-disable-next-line import/first
import { computeMcpUrlHash } from "../mcp-server-hash.js";

function baseRow(over: Record<string, unknown> = {}) {
  return {
    mcp_server_id: "srv-1",
    name: "Test Server",
    slug: "test-server",
    url: "https://mcp.example/a",
    transport: "streamable-http",
    auth_type: "none",
    auth_config: null,
    server_enabled: true,
    server_status: "approved",
    server_url_hash: null,
    management_source: "manual",
    plugin_install_id: null,
    runtime_metadata: null,
    tools: null,
    assignment_enabled: true,
    assignment_config: null,
    ...over,
  };
}

function recordLinkMetadata(over: Record<string, unknown> = {}) {
  return {
    recordLinkHints: {
      schemaVersion: 1,
      source: "plugin-manifest",
      browserBaseUrl: "https://crm.example",
      routes: [
        {
          objectType: "opportunity",
          routeTemplate: "/object/opportunity/{id}",
          idFields: ["id"],
          labelFields: ["name"],
        },
      ],
      ...over,
    },
  };
}

const activePluginAuth = {
  resolveToken: vi.fn(async () => null),
  resolveHeaders: vi.fn(async () => null),
  hasActiveActivation: vi.fn(async () => true),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRowsForAgent.mockReturnValue([{ tenant_id: "tenant-1" }]);
  mockRowsForAssignments.mockReturnValue([]);
  mockRowsForUserToken.mockReturnValue([]);
  mockSecretString.mockReturnValue("");
});

describe("buildMcpConfigs — approval + hash-pin filtering", () => {
  it("SQL predicate requires status='approved' AND enabled=true", async () => {
    mockRowsForJoin.mockReturnValue([]);
    await buildMcpConfigs("agent-1", null);
    const pred = mockWhereSelector.mock.calls[1]?.[0] as { _and: unknown[] };
    // Flatten the predicate terms to check the literal values included.
    const literals = JSON.stringify(pred);
    expect(literals).toContain('"approved"');
  });

  it("returns approved tenant MCP rows without an agent assignment", async () => {
    mockRowsForAssignments.mockReturnValue([]);
    mockRowsForJoin.mockReturnValue([
      baseRow({ server_url_hash: null, auth_type: "none" }),
    ]);

    const configs = await buildMcpConfigs("agent-1", null);

    expect(configs).toEqual([
      {
        name: "test-server",
        url: "https://mcp.example/a",
        transport: "streamable-http",
      },
    ]);
  });

  it("skips an enabled tenant MCP row when the agent override disables it", async () => {
    mockRowsForAssignments.mockReturnValue([
      { mcp_server_id: "srv-1", enabled: false, config: null },
    ]);
    mockRowsForJoin.mockReturnValue([
      baseRow({ server_url_hash: null, auth_type: "none" }),
    ]);

    const configs = await buildMcpConfigs("agent-1", null);

    expect(configs).toEqual([]);
  });

  it("grandfathered approved rows (url_hash=null) are returned", async () => {
    mockRowsForJoin.mockReturnValue([
      baseRow({ server_url_hash: null, auth_type: "none" }),
    ]);
    const configs = await buildMcpConfigs("agent-1", null);
    expect(configs).toHaveLength(1);
    expect(configs[0]!.name).toBe("test-server");
  });

  it("approved plugin rows include sanitized runtime record-link hints", async () => {
    mockRowsForJoin.mockReturnValue([
      baseRow({
        slug: "twenty--crm",
        auth_type: "none",
        management_source: "plugin",
        plugin_install_id: "install-twenty",
        runtime_metadata: recordLinkMetadata(),
      }),
    ]);

    const configs = await buildMcpConfigs(
      "agent-1",
      {
        humanPairId: null,
        requesterUserId: "requester-1",
      },
      "[test]",
      { pluginAuth: activePluginAuth },
    );

    expect(configs).toEqual([
      {
        name: "twenty--crm",
        url: "https://mcp.example/a",
        transport: "streamable-http",
        recordLinkHints: {
          schemaVersion: 1,
          source: "plugin-manifest",
          browserBaseUrl: "https://crm.example",
          routes: [
            {
              objectType: "opportunity",
              routeTemplate: "/object/opportunity/{id}",
              idFields: ["id"],
              labelFields: ["name"],
            },
          ],
        },
      },
    ]);
  });

  it("malformed runtime record-link hints are ignored without dropping the server", async () => {
    mockRowsForJoin.mockReturnValue([
      baseRow({
        slug: "twenty--crm",
        auth_type: "none",
        management_source: "plugin",
        plugin_install_id: "install-twenty",
        runtime_metadata: recordLinkMetadata({
          browserBaseUrl: "http://crm.example",
        }),
      }),
    ]);

    const configs = await buildMcpConfigs(
      "agent-1",
      {
        humanPairId: null,
        requesterUserId: "requester-1",
      },
      "[test]",
      { pluginAuth: activePluginAuth },
    );

    expect(configs).toEqual([
      {
        name: "twenty--crm",
        url: "https://mcp.example/a",
        transport: "streamable-http",
      },
    ]);
  });

  it("manual rows do not emit record-link hints even if metadata exists", async () => {
    mockRowsForJoin.mockReturnValue([
      baseRow({
        auth_type: "none",
        runtime_metadata: recordLinkMetadata(),
      }),
    ]);

    const configs = await buildMcpConfigs("agent-1", null);

    expect(configs).toEqual([
      {
        name: "test-server",
        url: "https://mcp.example/a",
        transport: "streamable-http",
      },
    ]);
  });

  it("approved rows with matching url_hash are returned", async () => {
    const url = "https://mcp.example/a";
    const authConfig = { token: "tkn" };
    const hash = computeMcpUrlHash(url, authConfig);
    mockRowsForJoin.mockReturnValue([
      baseRow({
        url,
        auth_config: authConfig,
        auth_type: "tenant_api_key",
        server_url_hash: hash,
      }),
    ]);
    const configs = await buildMcpConfigs("agent-1", null);
    expect(configs).toHaveLength(1);
  });

  it("tenant_api_key resolves the bearer from auth_config.secretRef", async () => {
    const url = "https://mcp.example/a";
    const authConfig = { secretRef: "arn:aws:secretsmanager:tenant-api-key" };
    mockSecretString.mockReturnValue(
      JSON.stringify({ type: "mcpApiKey", token: "secret-backed-token" }),
    );
    mockRowsForJoin.mockReturnValue([
      baseRow({
        url,
        auth_config: authConfig,
        auth_type: "tenant_api_key",
        server_url_hash: computeMcpUrlHash(url, authConfig),
      }),
    ]);

    const configs = await buildMcpConfigs("agent-1", null);

    expect(configs).toEqual([
      {
        name: "test-server",
        url,
        transport: "streamable-http",
        auth: { type: "bearer", token: "secret-backed-token" },
      },
    ]);
  });

  it("approved rows with mismatched url_hash are SKIPPED (SI-5 defensive)", async () => {
    mockRowsForJoin.mockReturnValue([
      baseRow({
        auth_type: "none",
        url: "https://mcp.example/a",
        auth_config: { token: "a" },
        // Hash computed from a different auth_config — drift should fail closed.
        server_url_hash: computeMcpUrlHash("https://mcp.example/a", {
          token: "original",
        }),
      }),
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const configs = await buildMcpConfigs("agent-1", null);
    expect(configs).toHaveLength(0);
    expect(JSON.stringify(configs)).not.toContain("recordLinkHints");
    expect(warn).toHaveBeenCalled();
    const msg = warn.mock.calls[0]?.[0] as string;
    expect(msg).toContain("url_hash mismatch");
    warn.mockRestore();
  });

  it("server_enabled=false rows are skipped even if status=approved", async () => {
    mockRowsForJoin.mockReturnValue([
      baseRow({ server_enabled: false, auth_type: "none" }),
    ]);
    const configs = await buildMcpConfigs("agent-1", null);
    expect(configs).toHaveLength(0);
  });

  it("tenant_api_key without a token is skipped", async () => {
    mockRowsForJoin.mockReturnValue([
      baseRow({
        auth_type: "tenant_api_key",
        auth_config: {},
      }),
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const configs = await buildMcpConfigs("agent-1", null);
    expect(configs).toHaveLength(0);
    warn.mockRestore();
  });

  it("includes cached MCP tool names so desktop Pi can enforce allowlist exclusions", async () => {
    mockRowsForAssignments.mockReturnValue([
      {
        mcp_server_id: "srv-1",
        enabled: true,
        config: { toolAllowlist: ["opportunities_list"] },
      },
    ]);
    mockRowsForJoin.mockReturnValue([
      baseRow({
        auth_type: "none",
        tools: [
          { name: "opportunities_list", description: "List opportunities" },
          { name: "accounts_list", description: "List accounts" },
        ],
      }),
    ]);

    const configs = await buildMcpConfigs("agent-1", null);

    expect(configs[0]).toMatchObject({
      name: "test-server",
      tools: ["opportunities_list"],
      availableTools: ["opportunities_list", "accounts_list"],
    });
  });

  it("per-user OAuth looks up the active token by user_id and returns bearer auth", async () => {
    const userId = "user-current-1";
    const agentId = "agent-assigned-1";
    mockRowsForJoin.mockReturnValue([
      baseRow({
        mcp_server_id: "srv-user-memory",
        slug: "user-memory",
        auth_type: "per_user_oauth",
      }),
    ]);
    mockRowsForUserToken.mockReturnValue([
      {
        id: "tok-1",
        secret_ref: "arn:aws:secretsmanager:us-east-1:123:secret:user-memory",
        status: "active",
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
      },
    ]);
    mockSecretString.mockReturnValue(
      JSON.stringify({ access_token: "user-scoped-token" }),
    );

    const configs = await buildMcpConfigs(agentId, {
      humanPairId: userId,
      requesterUserId: null,
    });

    expect(configs).toEqual([
      {
        name: "user-memory",
        url: "https://mcp.example/a",
        transport: "streamable-http",
        auth: { type: "bearer", token: "user-scoped-token" },
      },
    ]);
    const tokenLookupPredicate = mockWhereSelector.mock.calls
      .map((call) => call[0])
      .find((predicate) =>
        JSON.stringify(predicate).includes("userMcpTokens.user_id"),
      ) as { _and: unknown[] };
    expect(JSON.stringify(tokenLookupPredicate)).toContain(
      `"userMcpTokens.user_id","${userId}"`,
    );
    expect(JSON.stringify(tokenLookupPredicate)).not.toContain(
      `"userMcpTokens.user_id","${agentId}"`,
    );
    expect(JSON.stringify(tokenLookupPredicate)).toContain(
      '"userMcpTokens.status","active"',
    );
  });

  it("direct per-user OAuth prefers requesterUserId over the agent human pair", async () => {
    mockRowsForJoin.mockReturnValue([
      baseRow({
        mcp_server_id: "srv-dispatch",
        slug: "dispatch",
        auth_type: "per_user_oauth",
      }),
    ]);
    mockRowsForUserToken.mockReturnValue([
      {
        id: "tok-requester",
        secret_ref: "arn:aws:secretsmanager:us-east-1:123:secret:dispatch",
        status: "active",
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
      },
    ]);
    mockSecretString.mockReturnValue(
      JSON.stringify({ access_token: "requester-token" }),
    );

    const configs = await buildMcpConfigs("agent-1", {
      humanPairId: "user-human-pair",
      requesterUserId: "user-requester",
    });

    expect(configs).toEqual([
      {
        name: "dispatch",
        url: "https://mcp.example/a",
        transport: "streamable-http",
        auth: { type: "bearer", token: "requester-token" },
      },
    ]);
    const tokenLookupPredicate = mockWhereSelector.mock.calls
      .map((call) => call[0])
      .find((predicate) =>
        JSON.stringify(predicate).includes("userMcpTokens.user_id"),
      ) as { _and: unknown[] };
    expect(JSON.stringify(tokenLookupPredicate)).toContain(
      '"userMcpTokens.user_id","user-requester"',
    );
    expect(JSON.stringify(tokenLookupPredicate)).not.toContain(
      '"userMcpTokens.user_id","user-human-pair"',
    );
  });

  it("canonical OAuth servers without an active user token are skipped", async () => {
    mockRowsForJoin.mockReturnValue([
      baseRow({
        mcp_server_id: "srv-twenty",
        slug: "twenty-crm",
        auth_type: "oauth",
      }),
    ]);
    mockRowsForUserToken.mockReturnValue([]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const configs = await buildMcpConfigs("agent-1", {
      humanPairId: "user-current-1",
      requesterUserId: null,
    });

    expect(configs).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("user has not completed OAuth"),
    );
    warn.mockRestore();
  });

  it("canonical OAuth servers inject the current user's active token", async () => {
    mockRowsForJoin.mockReturnValue([
      baseRow({
        mcp_server_id: "srv-twenty",
        slug: "twenty-crm",
        auth_type: "oauth",
      }),
    ]);
    mockRowsForUserToken.mockReturnValue([
      {
        id: "tok-twenty",
        secret_ref: "arn:aws:secretsmanager:us-east-1:123:secret:twenty",
        status: "active",
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
      },
    ]);
    mockSecretString.mockReturnValue(
      JSON.stringify({ access_token: "twenty-user-token" }),
    );

    const configs = await buildMcpConfigs("agent-1", {
      humanPairId: "user-current-1",
      requesterUserId: null,
    });

    expect(configs).toEqual([
      {
        name: "twenty-crm",
        url: "https://mcp.example/a",
        transport: "streamable-http",
        auth: { type: "bearer", token: "twenty-user-token" },
      },
    ]);
  });
});
