/**
 * buildMcpConfigs probe-mode tests (capability-mapping plan U3, KTD-1).
 *
 * The inspector path classifies token state from stored metadata ONLY:
 * zero Secrets Manager reads, zero token-endpoint calls, zero
 * user_mcp_tokens writes. With WorkOS refresh-token rotation, a refresh
 * fired from the inspector could burn a live connection — these tests are
 * the regression net for that invariant.
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
    name: "GitHub",
    slug: "github",
    url: "https://mcp.example/github",
    transport: "streamable-http",
    auth_type: "per_user_oauth",
    auth_config: { client_id: "client-abc" },
    tools: [{ name: "search_issues" }],
    server_enabled: true,
    server_status: "approved",
    server_url_hash: null,
    management_source: "direct",
    plugin_install_id: null,
    runtime_metadata: null,
    ...overrides,
  };
}

function activeTokenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "token-1",
    secret_ref: "arn:aws:secretsmanager:token-1",
    status: "active",
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
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

function expectZeroSideEffects() {
  expect(mockSmSend).not.toHaveBeenCalled();
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(mockDbUpdate).not.toHaveBeenCalled();
}

describe("probe mode: per-user OAuth (AE2 substrate)", () => {
  it("active token → included with tokenStatus=active, no auth material, zero side effects", async () => {
    mockRowsForUserToken.mockReturnValue([activeTokenRow()]);
    const { configs } = await probeBuild({
      humanPairId: null,
      requesterUserId: USER_ID,
    });
    expect(configs).toHaveLength(1);
    expect(configs[0]).toMatchObject({ name: "github", tokenStatus: "active" });
    expect(configs[0].auth).toBeUndefined();
    expectZeroSideEffects();
  });

  it("expired token → included with tokenStatus=expired, NO refresh attempted", async () => {
    mockRowsForUserToken.mockReturnValue([
      activeTokenRow({
        expires_at: new Date(Date.now() - 60 * 1000).toISOString(),
      }),
    ]);
    const { configs } = await probeBuild({
      humanPairId: null,
      requesterUserId: USER_ID,
    });
    expect(configs[0]).toMatchObject({ tokenStatus: "expired" });
    expectZeroSideEffects();
  });

  it("no stored token → excluded with an oauth_missing diagnostic", async () => {
    const { configs, diagnostics } = await probeBuild({
      humanPairId: null,
      requesterUserId: USER_ID,
    });
    expect(configs).toEqual([]);
    expect(diagnostics.drops).toContainEqual(
      expect.objectContaining({
        capabilityClass: "mcp_server",
        capabilityId: "github",
        reason: "oauth_missing",
      }),
    );
    expectZeroSideEffects();
  });

  it("no requester → direct server probes via the human pair (scheduled-turn semantics)", async () => {
    mockRowsForUserToken.mockReturnValue([activeTokenRow()]);
    const { configs } = await probeBuild({
      humanPairId: HUMAN_PAIR_ID,
      requesterUserId: null,
    });
    expect(configs[0]).toMatchObject({ tokenStatus: "active" });
    expectZeroSideEffects();
  });

  it("no requester AND no human pair → oauth_missing", async () => {
    const { configs, diagnostics } = await probeBuild({
      humanPairId: null,
      requesterUserId: null,
    });
    expect(configs).toEqual([]);
    expect(diagnostics.drops[0]).toMatchObject({ reason: "oauth_missing" });
    expectZeroSideEffects();
  });
});

describe("probe mode: plugin servers fail closed without a requester", () => {
  it("per-user plugin server with no requester → plugin_gate_fail_closed", async () => {
    mockRowsForServers.mockReturnValue([
      serverRow({
        management_source: "plugin",
        plugin_install_id: "install-1",
        auth_type: "per_user_oauth",
      }),
    ]);
    const { configs, diagnostics } = await probeBuild({
      humanPairId: HUMAN_PAIR_ID,
      requesterUserId: null,
    });
    expect(configs).toEqual([]);
    expect(diagnostics.drops[0]).toMatchObject({
      reason: "plugin_gate_fail_closed",
    });
    expectZeroSideEffects();
  });

  it("user_headers plugin server probes activation only — token minting never runs", async () => {
    mockRowsForServers.mockReturnValue([
      serverRow({
        management_source: "plugin",
        plugin_install_id: "install-1",
        auth_type: "user_headers",
        auth_config: { headers: [{ name: "X-Api-Key" }] },
      }),
    ]);
    mockHasActiveActivation.mockResolvedValue(true);
    const { configs } = await probeBuild({
      humanPairId: null,
      requesterUserId: USER_ID,
    });
    expect(configs[0]).toMatchObject({ tokenStatus: "active" });
    expect(mockHasActiveActivation).toHaveBeenCalledWith(USER_ID, "install-1");
    expectZeroSideEffects();
  });

  it("user_headers plugin server without activation → plugin_activation_missing", async () => {
    mockRowsForServers.mockReturnValue([
      serverRow({
        management_source: "plugin",
        plugin_install_id: "install-1",
        auth_type: "user_headers",
        auth_config: { headers: [{ name: "X-Api-Key" }] },
      }),
    ]);
    mockHasActiveActivation.mockResolvedValue(false);
    const { configs, diagnostics } = await probeBuild({
      humanPairId: null,
      requesterUserId: USER_ID,
    });
    expect(configs).toEqual([]);
    expect(diagnostics.drops[0]).toMatchObject({
      reason: "plugin_activation_missing",
    });
    expectZeroSideEffects();
  });
});

describe("probe mode: tenant/service credentials", () => {
  it("tenant_api_key with a secretRef → configured, WITHOUT reading the secret", async () => {
    mockRowsForServers.mockReturnValue([
      serverRow({
        auth_type: "tenant_api_key",
        auth_config: { secretRef: "arn:aws:secretsmanager:key-1" },
      }),
    ]);
    const { configs } = await probeBuild({
      humanPairId: null,
      requesterUserId: USER_ID,
    });
    expect(configs[0]).toMatchObject({ tokenStatus: "configured" });
    expectZeroSideEffects();
  });

  it("tenant_api_key without credentials → credential_missing", async () => {
    mockRowsForServers.mockReturnValue([
      serverRow({ auth_type: "tenant_api_key", auth_config: {} }),
    ]);
    const { configs, diagnostics } = await probeBuild({
      humanPairId: null,
      requesterUserId: USER_ID,
    });
    expect(configs).toEqual([]);
    expect(diagnostics.drops[0]).toMatchObject({
      reason: "credential_missing",
    });
    expectZeroSideEffects();
  });

  it("revoked plugin service credential → credential_missing without a secret read", async () => {
    mockRowsForServers.mockReturnValue([
      serverRow({
        management_source: "plugin",
        plugin_install_id: "install-1",
        auth_type: "service_credential",
        auth_config: {
          revoked: true,
          secretRef: "arn:x",
          headers: [{ name: "Authorization", secretJsonKey: "token" }],
        },
      }),
    ]);
    const { configs, diagnostics } = await probeBuild({
      humanPairId: null,
      requesterUserId: USER_ID,
    });
    expect(configs).toEqual([]);
    expect(diagnostics.drops[0]).toMatchObject({
      reason: "credential_missing",
      detail: expect.stringContaining("revoked"),
    });
    expectZeroSideEffects();
  });
});
