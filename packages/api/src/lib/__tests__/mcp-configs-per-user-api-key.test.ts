/**
 * buildMcpConfigs per_user_api_key tests.
 *
 * per_user_api_key servers (e.g. ThinkWork Brain per-user tkt_ keys) share
 * the per-user OAuth custody — a user_mcp_tokens row + per-user Secrets
 * Manager secret — but the stored key IS the bearer: no refresh, no expiry,
 * and never the external OAuth resolver. A user with no saved key gets the
 * server silently skipped (credential_missing), exactly like an
 * unconnected OAuth user.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const {
  mockRowsForAgent,
  mockRowsForServers,
  mockRowsForAssignments,
  mockRowsForUserToken,
  mockDbUpdate,
  mockSmSend,
  mockHasActiveActivation,
} = vi.hoisted(() => ({
  mockRowsForAgent: vi.fn(),
  mockRowsForServers: vi.fn(),
  mockRowsForAssignments: vi.fn(),
  mockRowsForUserToken: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockSmSend: vi.fn(),
  mockHasActiveActivation: vi.fn(),
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          const tableRecord = (table ?? {}) as Record<string, unknown>;
          if (tableRecord.id === "agents.id") {
            return { limit: () => Promise.resolve(mockRowsForAgent()) };
          }
          if (tableRecord.id === "tenantMcpServers.id") {
            return Promise.resolve(mockRowsForServers());
          }
          if (tableRecord.mcp_server_id === "agentMcpServers.mcp_server_id") {
            return Promise.resolve(mockRowsForAssignments());
          }
          return { limit: () => Promise.resolve(mockRowsForUserToken()) };
        },
      }),
    }),
    update: (...args: unknown[]) => {
      mockDbUpdate(...args);
      return { set: () => ({ where: () => Promise.resolve() }) };
    },
  }),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  tenantMcpServers: {
    id: "tenantMcpServers.id",
    tenant_id: "tenantMcpServers.tenant_id",
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
  agents: { id: "agents.id", tenant_id: "agents.tenant_id" },
  agentMcpServers: {
    agent_id: "agentMcpServers.agent_id",
    mcp_server_id: "agentMcpServers.mcp_server_id",
    enabled: "agentMcpServers.enabled",
    config: "agentMcpServers.config",
  },
  userMcpTokens: {
    id: "userMcpTokens.id",
    user_id: "userMcpTokens.user_id",
    mcp_server_id: "userMcpTokens.mcp_server_id",
    secret_ref: "userMcpTokens.secret_ref",
    status: "userMcpTokens.status",
    expires_at: "userMcpTokens.expires_at",
  },
}));

vi.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: class {
    send = mockSmSend;
  },
  GetSecretValueCommand: class {
    constructor(public readonly input: unknown) {}
  },
  UpdateSecretCommand: class {
    constructor(public readonly input: unknown) {}
  },
}));

vi.mock("../plugins/activation.js", () => ({
  createPluginDispatchAuthResolver: () => ({
    hasActiveActivation: mockHasActiveActivation,
    resolveToken: vi.fn(),
    resolveHeaders: vi.fn(),
  }),
}));

import { buildMcpConfigs } from "../mcp-configs.js";
import { createCapabilityDiagnostics } from "../capability-diagnostics.js";

const AGENT_ID = "agent-1";
const USER_ID = "user-1";
const HUMAN_PAIR_ID = "human-1";

function serverRow(overrides: Record<string, unknown> = {}) {
  return {
    mcp_server_id: "server-1",
    name: "Company Brain",
    slug: "company-brain",
    url: "https://mcp.brain.example/mcp",
    transport: "streamable-http",
    auth_type: "per_user_api_key",
    auth_config: null,
    tools: [{ name: "search_memory" }],
    server_enabled: true,
    server_status: "approved",
    server_url_hash: null,
    management_source: "manual",
    plugin_install_id: null,
    runtime_metadata: null,
    ...overrides,
  };
}

function keyTokenRow(overrides: Record<string, unknown> = {}) {
  // Personal API key rows carry no expiry — the key never refreshes.
  return {
    id: "token-1",
    secret_ref: "arn:aws:secretsmanager:key-secret-1",
    status: "active",
    expires_at: null,
    ...overrides,
  };
}

const fetchSpy = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockRowsForAgent.mockReturnValue([{ tenant_id: "tenant-1" }]);
  mockRowsForServers.mockReturnValue([serverRow()]);
  mockRowsForAssignments.mockReturnValue([]);
  mockRowsForUserToken.mockReturnValue([]);
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolve mode: per_user_api_key", () => {
  it("resolves the requester's stored key as the bearer with no refresh traffic", async () => {
    mockRowsForUserToken.mockReturnValue([keyTokenRow()]);
    mockSmSend.mockResolvedValue({
      SecretString: JSON.stringify({
        access_token: "tkt_user_key",
        token_type: "Bearer",
      }),
    });

    const configs = await buildMcpConfigs(
      AGENT_ID,
      { humanPairId: null, requesterUserId: USER_ID },
      "[test]",
    );

    expect(configs).toEqual([
      expect.objectContaining({
        name: "company-brain",
        auth: { type: "bearer", token: "tkt_user_key" },
      }),
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("skips the server with credential_missing when the user has no saved key", async () => {
    const diagnostics = createCapabilityDiagnostics();
    const configs = await buildMcpConfigs(
      AGENT_ID,
      { humanPairId: null, requesterUserId: USER_ID },
      "[test]",
      { diagnostics },
    );

    expect(configs).toEqual([]);
    expect(diagnostics.drops).toContainEqual(
      expect.objectContaining({
        capabilityClass: "mcp_server",
        capabilityId: "company-brain",
        reason: "credential_missing",
      }),
    );
  });

  it("falls back to the human pair's key on scheduled turns (R16 semantics)", async () => {
    mockRowsForUserToken.mockReturnValue([keyTokenRow()]);
    mockSmSend.mockResolvedValue({
      SecretString: JSON.stringify({ access_token: "tkt_pair_key" }),
    });

    const configs = await buildMcpConfigs(
      AGENT_ID,
      { humanPairId: HUMAN_PAIR_ID, requesterUserId: null },
      "[test]",
    );

    expect(configs).toEqual([
      expect.objectContaining({
        auth: { type: "bearer", token: "tkt_pair_key" },
      }),
    ]);
  });

  it("never consults the external OAuth resolver for per_user_api_key servers", async () => {
    mockRowsForUserToken.mockReturnValue([keyTokenRow()]);
    mockSmSend.mockResolvedValue({
      SecretString: JSON.stringify({ access_token: "tkt_user_key" }),
    });
    const resolve = vi.fn(async () => "vault-token");
    const supports = vi.fn(() => true);

    const configs = await buildMcpConfigs(
      AGENT_ID,
      { humanPairId: null, requesterUserId: USER_ID },
      "[test]",
      { userOAuth: { supports, probe: vi.fn(), resolve } },
    );

    expect(configs).toEqual([
      expect.objectContaining({
        auth: { type: "bearer", token: "tkt_user_key" },
      }),
    ]);
    expect(supports).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe("probe mode: per_user_api_key", () => {
  async function probeBuild(
    requester: {
      humanPairId: string | null;
      requesterUserId: string | null;
    } | null,
  ) {
    const diagnostics = createCapabilityDiagnostics();
    const configs = await buildMcpConfigs(AGENT_ID, requester, "[test]", {
      tokenMode: "probe",
      diagnostics,
    });
    return { configs, diagnostics };
  }

  it("saved key → tokenStatus=active with zero side effects", async () => {
    mockRowsForUserToken.mockReturnValue([keyTokenRow()]);
    const { configs } = await probeBuild({
      humanPairId: null,
      requesterUserId: USER_ID,
    });
    expect(configs).toHaveLength(1);
    expect(configs[0]).toMatchObject({
      name: "company-brain",
      tokenStatus: "active",
    });
    expect(configs[0].auth).toBeUndefined();
    expect(mockSmSend).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("no saved key → excluded with credential_missing", async () => {
    const { configs, diagnostics } = await probeBuild({
      humanPairId: null,
      requesterUserId: USER_ID,
    });
    expect(configs).toEqual([]);
    expect(diagnostics.drops[0]).toMatchObject({
      reason: "credential_missing",
      detail: expect.stringContaining("personal API key"),
    });
  });

  it("no requester AND no human pair → credential_missing", async () => {
    const { configs, diagnostics } = await probeBuild({
      humanPairId: null,
      requesterUserId: null,
    });
    expect(configs).toEqual([]);
    expect(diagnostics.drops[0]).toMatchObject({
      reason: "credential_missing",
    });
  });
});
