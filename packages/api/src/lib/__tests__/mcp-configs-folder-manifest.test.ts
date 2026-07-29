/**
 * buildMcpConfigs folder-manifest resolution tests (THINK-173 U5, R20).
 *
 * A `capability_folder_dispatch=true` agent resolves its attached
 * connection set EXCLUSIVELY from the rendered capabilities manifest —
 * all-or-nothing per agent, never per-file fallback. Flag-off agents are
 * byte-identical to the legacy path. The per-user OAuth auth loop is
 * unchanged (KTD-2), including the direct-server `humanPairId` fallback
 * for requester-less wakeup turns (AE7).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRowsForAgent,
  mockRowsForJoin,
  mockRowsForAssignments,
  mockRowsForUserToken,
  mockSecretString,
  mockWhereSelector,
} = vi.hoisted(() => ({
  mockRowsForAgent: vi.fn(),
  mockRowsForJoin: vi.fn(),
  mockRowsForAssignments: vi.fn(),
  mockRowsForUserToken: vi.fn(),
  mockSecretString: vi.fn(),
  mockWhereSelector: vi.fn(),
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: () => ({
      from: (table: unknown) => ({
        where: (predicate: unknown) => {
          mockWhereSelector(predicate);
          const tableRecord =
            table && typeof table === "object"
              ? (table as Record<string, unknown>)
              : {};
          if (tableRecord.id === "agents.id") {
            return { limit: () => Promise.resolve(mockRowsForAgent()) };
          }
          if (tableRecord.id === "tenantMcpServers.id") {
            return Promise.resolve(mockRowsForJoin());
          }
          if (tableRecord.mcp_server_id === "agentMcpServers.mcp_server_id") {
            return Promise.resolve(mockRowsForAssignments());
          }
          return { limit: () => Promise.resolve(mockRowsForUserToken()) };
        },
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
    slug: "agents.slug",
    capability_folder_dispatch: "agents.capability_folder_dispatch",
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
import { buildMcpConfigs, type WorkspaceMcpHelpers } from "../mcp-configs.js";
// eslint-disable-next-line import/first
import type {
  CapabilitiesManifest,
  CapabilityManifestEntry,
} from "../capabilities/manifest-compile.js";

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
    ...over,
  };
}

function connectionEntry(
  over: Partial<CapabilityManifestEntry> = {},
): CapabilityManifestEntry {
  return {
    name: "test-server",
    slug: "test-server",
    class: "connection",
    type: "mcp",
    principalType: "app",
    operations: [],
    permittedOperations: null,
    credentialRefs: { registryServerId: "srv-1" },
    ...over,
  };
}

function manifest(entries: CapabilityManifestEntry[]): CapabilitiesManifest {
  return {
    version: 1,
    fingerprint: "f".repeat(64),
    input_signature: "sig-1",
    generated_at: "2026-07-05T00:00:00.000Z",
    agent: { tenant_id: "tenant-1", agent_slug: "agent-x" },
    active: entries,
    withheld: [],
    signature: null,
  };
}

/** Workspace-file helpers wired with spies — the folder path must never touch them. */
function spiedFileStore(): WorkspaceMcpHelpers {
  return {
    resolveAgentWorkspacePrefix: vi.fn(async () => "tenants/acme/agents/x/"),
    listWorkspaceMcpSlugs: vi.fn(async () => ["test-server"]),
    readMcpAssignmentState: vi.fn(async () => null),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRowsForAgent.mockReturnValue([
    {
      tenant_id: "tenant-1",
      slug: "agent-x",
      capability_folder_dispatch: true,
    },
  ]);
  mockRowsForJoin.mockReturnValue([baseRow()]);
  mockRowsForAssignments.mockReturnValue([]);
  mockRowsForUserToken.mockReturnValue([]);
  mockSecretString.mockReturnValue("");
});

describe("buildMcpConfigs — folder-manifest resolution (THINK-173 U5)", () => {
  it("flag on: resolves from the manifest and never consults workspace files", async () => {
    const files = spiedFileStore();
    const configs = await buildMcpConfigs("agent-1", null, "[test]", {
      workspaceMcp: files,
      folderCapabilities: { manifest: manifest([connectionEntry()]) },
    });
    expect(configs).toEqual([
      {
        name: "test-server",
        url: "https://mcp.example/a",
        transport: "streamable-http",
      },
    ]);
    expect(files.listWorkspaceMcpSlugs).not.toHaveBeenCalled();
    expect(files.readMcpAssignmentState).not.toHaveBeenCalled();
  });

  it("flag on: permittedOperations become the tool allowlist overlay", async () => {
    mockRowsForJoin.mockReturnValue([
      baseRow({
        tools: [{ name: "opportunities_list" }, { name: "accounts_list" }],
      }),
    ]);
    const configs = await buildMcpConfigs("agent-1", null, "[test]", {
      folderCapabilities: {
        manifest: manifest([
          connectionEntry({ permittedOperations: ["opportunities_list"] }),
        ]),
      },
    });
    expect(configs).toHaveLength(1);
    expect(configs[0]?.tools).toEqual(["opportunities_list"]);
  });

  // The analyst policy-source flip is retired along with the analyst
  // data-source subsystem: the approved registry row is now the only
  // enforcement source, and a differing sidecar policy never overrides it.
  it("the registry row enforces even when the sidecar policy differs", async () => {
    const configs = await buildMcpConfigs("agent-1", null, "[test]", {
      folderCapabilities: {
        manifest: manifest([
          connectionEntry({
            policy: {
              budgets: { maxQueriesPerRun: 1, maxQueriesPerTenantDay: 1 },
            },
          }),
        ]),
      },
    });
    // Pre-flip the connection still dispatches exactly as before.
    expect(configs).toHaveLength(1);
    expect(configs[0]?.name).toBe("test-server");
  });

  it("flag on: api-type connections do not produce MCP configs", async () => {
    const configs = await buildMcpConfigs("agent-1", null, "[test]", {
      folderCapabilities: {
        manifest: manifest([
          connectionEntry({
            slug: "firecrawl",
            name: "firecrawl",
            type: "api",
          }),
        ]),
      },
    });
    expect(configs).toEqual([]);
  });

  it("flag on: unknown registry ref is skipped, not silently DB-resolved", async () => {
    const configs = await buildMcpConfigs("agent-1", null, "[test]", {
      folderCapabilities: {
        manifest: manifest([
          connectionEntry({
            slug: "ghost",
            name: "ghost",
            credentialRefs: { registryServerId: "srv-missing" },
          }),
        ]),
      },
    });
    expect(configs).toEqual([]);
  });

  it("flag on + defer: returns zero configs for the pre-render resolution pass", async () => {
    const configs = await buildMcpConfigs("agent-1", null, "[test]", {
      folderCapabilities: { defer: true },
    });
    expect(configs).toEqual([]);
  });

  it("flag on + folder-unaware caller: throws (R20 — no silent legacy fallback)", async () => {
    await expect(buildMcpConfigs("agent-1", null, "[test]")).rejects.toThrow(
      /not folder-aware/,
    );
  });

  it("flag on + missing manifest: throws loudly (R9)", async () => {
    await expect(
      buildMcpConfigs("agent-1", null, "[test]", {
        folderCapabilities: { manifest: null },
      }),
    ).rejects.toThrow(/no capabilities manifest/);
  });

  it("flag off: byte-identical legacy path, folderCapabilities ignored", async () => {
    mockRowsForAgent.mockReturnValue([
      {
        tenant_id: "tenant-1",
        slug: null,
        capability_folder_dispatch: false,
      },
    ]);
    const withDeps = await buildMcpConfigs("agent-1", null, "[test]", {
      folderCapabilities: { manifest: manifest([]) },
    });
    const without = await buildMcpConfigs("agent-1", null, "[test]");
    expect(withDeps).toEqual(without);
    expect(withDeps).toEqual([
      {
        name: "test-server",
        url: "https://mcp.example/a",
        transport: "streamable-http",
      },
    ]);
  });

  it("AE7: requester-less wakeup resolves a per_user_oauth folder connection via humanPairId", async () => {
    mockRowsForJoin.mockReturnValue([baseRow({ auth_type: "per_user_oauth" })]);
    mockRowsForUserToken.mockReturnValue([
      {
        id: "tok-1",
        secret_ref: "arn:aws:secretsmanager:us-east-1:123:secret:test",
        status: "active",
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
      },
    ]);
    mockSecretString.mockReturnValue(
      JSON.stringify({ access_token: "pair-token" }),
    );

    const configs = await buildMcpConfigs(
      "agent-1",
      { humanPairId: "user-pair-7", requesterUserId: null },
      "[test]",
      { folderCapabilities: { manifest: manifest([connectionEntry()]) } },
    );

    expect(configs).toEqual([
      {
        name: "test-server",
        url: "https://mcp.example/a",
        transport: "streamable-http",
        auth: { type: "bearer", token: "pair-token" },
      },
    ]);
    const tokenLookupPredicate = mockWhereSelector.mock.calls
      .map((call) => call[0])
      .find((predicate) =>
        JSON.stringify(predicate)?.includes("userMcpTokens.user_id"),
      );
    expect(JSON.stringify(tokenLookupPredicate)).toContain(
      '"userMcpTokens.user_id","user-pair-7"',
    );
  });
});

// ── THINK-302 U4c: first-class `mcp` grants (mcp/<slug>/MCP.md) ──────────────

function mcpEntry(
  over: Partial<CapabilityManifestEntry> = {},
): CapabilityManifestEntry {
  return {
    name: "test-server",
    slug: "test-server",
    class: "mcp",
    server: "srv-1",
    source_scope: "agent:agent-1",
    ...over,
  };
}

describe("buildMcpConfigs — first-class mcp grants (THINK-302 U4c)", () => {
  it("resolves an mcp entry by its MCP.md server ref → tenant registry row", async () => {
    const configs = await buildMcpConfigs("agent-1", null, "[test]", {
      folderCapabilities: { manifest: manifest([mcpEntry()]) },
    });
    expect(configs).toEqual([
      {
        name: "test-server",
        url: "https://mcp.example/a",
        transport: "streamable-http",
      },
    ]);
  });

  it("resolves an mcp entry by server SLUG when the ref is not a row id", async () => {
    const configs = await buildMcpConfigs("agent-1", null, "[test]", {
      folderCapabilities: {
        manifest: manifest([mcpEntry({ server: "test-server" })]),
      },
    });
    expect(configs).toHaveLength(1);
    expect(configs[0]?.name).toBe("test-server");
  });

  it("enabledTools become the tool allowlist overlay", async () => {
    mockRowsForJoin.mockReturnValue([
      baseRow({ tools: [{ name: "launch_run" }, { name: "get_run_status" }] }),
    ]);
    const configs = await buildMcpConfigs("agent-1", null, "[test]", {
      folderCapabilities: {
        manifest: manifest([mcpEntry({ enabledTools: ["launch_run"] })]),
      },
    });
    expect(configs).toHaveLength(1);
    expect(configs[0]?.tools).toEqual(["launch_run"]);
  });

  it("skips an mcp entry whose server ref has no approved+enabled registry row", async () => {
    const configs = await buildMcpConfigs("agent-1", null, "[test]", {
      folderCapabilities: {
        manifest: manifest([mcpEntry({ server: "no-such-server" })]),
      },
    });
    expect(configs).toEqual([]);
  });

  it("composes first-class mcp grants alongside legacy mcp-type connections", async () => {
    mockRowsForJoin.mockReturnValue([
      baseRow(),
      baseRow({
        mcp_server_id: "srv-2",
        name: "Second",
        slug: "second",
        url: "https://mcp.example/b",
      }),
    ]);
    const configs = await buildMcpConfigs("agent-1", null, "[test]", {
      folderCapabilities: {
        manifest: manifest([
          connectionEntry(),
          mcpEntry({ name: "second", slug: "second", server: "srv-2" }),
        ]),
      },
    });
    expect(configs.map((c) => c.name).sort()).toEqual([
      "second",
      "test-server",
    ]);
  });
});
