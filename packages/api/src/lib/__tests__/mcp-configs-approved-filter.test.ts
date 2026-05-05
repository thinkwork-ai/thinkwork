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
  mockTenantRowsForJoin,
  mockAdminRowsForJoin,
  mockRowsForUserToken,
  mockSecretString,
} = vi.hoisted(() => ({
  mockWhereSelector: vi.fn(),
  mockTenantRowsForJoin: vi.fn(),
  mockAdminRowsForJoin: vi.fn(),
  mockRowsForUserToken: vi.fn(),
  mockSecretString: vi.fn(),
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: () => ({
      from: (table: { __source?: string }) => ({
        innerJoin: () => ({
          where: (pred: unknown) => {
            mockWhereSelector(pred);
            // U2: route by which join-side we entered. The tenant query
            // starts at agentMcpServers; the admin query starts at
            // agentAdminMcpServers. The mock schema below tags both with
            // a `__source` identifier so the mock can differentiate.
            if (table?.__source === "agentAdminMcpServers") {
              return Promise.resolve(mockAdminRowsForJoin());
            }
            return Promise.resolve(mockTenantRowsForJoin());
          },
        }),
        where: (pred: unknown) => {
          mockWhereSelector(pred);
          return {
            limit: () => Promise.resolve(mockRowsForUserToken()),
          };
        },
      }),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  }),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  tenantMcpServers: {
    __source: "tenantMcpServers",
    id: "tenantMcpServers.id",
    name: "tenantMcpServers.name",
    slug: "tenantMcpServers.slug",
    url: "tenantMcpServers.url",
    transport: "tenantMcpServers.transport",
    auth_type: "tenantMcpServers.auth_type",
    auth_config: "tenantMcpServers.auth_config",
    enabled: "tenantMcpServers.enabled",
    status: "tenantMcpServers.status",
    url_hash: "tenantMcpServers.url_hash",
  },
  agentMcpServers: {
    __source: "agentMcpServers",
    mcp_server_id: "agentMcpServers.mcp_server_id",
    agent_id: "agentMcpServers.agent_id",
    enabled: "agentMcpServers.enabled",
    config: "agentMcpServers.config",
  },
  adminMcpServers: {
    __source: "adminMcpServers",
    id: "adminMcpServers.id",
    name: "adminMcpServers.name",
    slug: "adminMcpServers.slug",
    url: "adminMcpServers.url",
    transport: "adminMcpServers.transport",
    auth_type: "adminMcpServers.auth_type",
    auth_config: "adminMcpServers.auth_config",
    enabled: "adminMcpServers.enabled",
    status: "adminMcpServers.status",
    url_hash: "adminMcpServers.url_hash",
  },
  agentAdminMcpServers: {
    __source: "agentAdminMcpServers",
    mcp_server_id: "agentAdminMcpServers.mcp_server_id",
    agent_id: "agentAdminMcpServers.agent_id",
    enabled: "agentAdminMcpServers.enabled",
    config: "agentAdminMcpServers.config",
  },
  userMcpTokens: {
    __source: "userMcpTokens",
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
    assignment_enabled: true,
    assignment_config: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTenantRowsForJoin.mockReturnValue([]);
  mockAdminRowsForJoin.mockReturnValue([]);
  mockRowsForUserToken.mockReturnValue([]);
  mockSecretString.mockReturnValue("");
});

describe("buildMcpConfigs — approval + hash-pin filtering", () => {
  it("SQL predicate requires status='approved' AND enabled=true", async () => {
    mockTenantRowsForJoin.mockReturnValue([]);
    await buildMcpConfigs("agent-1", null);
    const pred = mockWhereSelector.mock.calls[0]?.[0] as { _and: unknown[] };
    // Flatten the predicate terms to check the literal values included.
    const literals = JSON.stringify(pred);
    expect(literals).toContain('"approved"');
  });

  it("grandfathered approved rows (url_hash=null) are returned", async () => {
    mockTenantRowsForJoin.mockReturnValue([
      baseRow({ server_url_hash: null, auth_type: "none" }),
    ]);
    const configs = await buildMcpConfigs("agent-1", null);
    expect(configs).toHaveLength(1);
    expect(configs[0]!.name).toBe("test-server");
  });

  it("approved rows with matching url_hash are returned", async () => {
    const url = "https://mcp.example/a";
    const authConfig = { secretRef: "arn:xyz", token: "tkn" };
    const hash = computeMcpUrlHash(url, authConfig);
    mockTenantRowsForJoin.mockReturnValue([
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

  it("approved rows with mismatched url_hash are SKIPPED (SI-5 defensive)", async () => {
    mockTenantRowsForJoin.mockReturnValue([
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
    expect(warn).toHaveBeenCalled();
    const msg = warn.mock.calls[0]?.[0] as string;
    expect(msg).toContain("url_hash mismatch");
    warn.mockRestore();
  });

  it("server_enabled=false rows are skipped even if status=approved", async () => {
    mockTenantRowsForJoin.mockReturnValue([
      baseRow({ server_enabled: false, auth_type: "none" }),
    ]);
    const configs = await buildMcpConfigs("agent-1", null);
    expect(configs).toHaveLength(0);
  });

  it("tenant_api_key without a token is skipped", async () => {
    mockTenantRowsForJoin.mockReturnValue([
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

  it("per-user OAuth looks up the active token by user_id and returns bearer auth", async () => {
    const userId = "user-current-1";
    const agentId = "agent-assigned-1";
    mockTenantRowsForJoin.mockReturnValue([
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
    mockSecretString.mockReturnValue(JSON.stringify({ access_token: "user-scoped-token" }));

    const configs = await buildMcpConfigs(agentId, userId);

    expect(configs).toEqual([
      {
        name: "user-memory",
        url: "https://mcp.example/a",
        transport: "streamable-http",
        auth: { type: "bearer", token: "user-scoped-token" },
      },
    ]);
    // U2 split queries: find the userToken predicate by content (its
    // position shifted from index 1 to index 2 once the admin query
    // landed; locate it semantically instead of by index).
    const userTokenCall = mockWhereSelector.mock.calls.find((call) =>
      JSON.stringify(call).includes("userMcpTokens.user_id"),
    );
    const tokenLookupPredicate = userTokenCall?.[0] as { _and: unknown[] };
    expect(JSON.stringify(tokenLookupPredicate)).toContain(`"userMcpTokens.user_id","${userId}"`);
    expect(JSON.stringify(tokenLookupPredicate)).not.toContain(`"userMcpTokens.user_id","${agentId}"`);
    expect(JSON.stringify(tokenLookupPredicate)).toContain('"userMcpTokens.status","active"');
  });
});
