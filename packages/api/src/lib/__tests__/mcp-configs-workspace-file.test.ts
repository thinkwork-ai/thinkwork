/**
 * buildMcpConfigs workspace-file resolution tests (Composer plan U9b).
 *
 * The runtime resolves an agent's ATTACHED MCP-server set from the
 * `mcp/<slug>/.assignment.json` files U9a dual-writes into the agent
 * workspace source, joining registry data via `registryServerId`. The
 * `agent_mcp_servers` DB read is the fallback for file-absent agents and S3
 * outages. Per-user OAuth/token resolution is unchanged from the DB path.
 *
 * The `workspaceMcp` dep is injected here so these tests never load the
 * S3/graphql-utils-coupled assignment-state module; the existing
 * DB-mocked suites (mcp-configs-approved-filter etc.) exercise the fallback.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRowsForAgent,
  mockRowsForJoin,
  mockRowsForAssignments,
  mockRowsForUserToken,
  mockSecretString,
} = vi.hoisted(() => ({
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
        where: () => {
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
import type { McpAssignmentState } from "../mcp/assignment-state.js";

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

const PREFIX = "tenants/acme/agents/agent-x/";

/** A stub workspace store backed by an in-memory slug→state map. */
function fileStore(
  entries: Record<string, McpAssignmentState | null>,
  over: Partial<WorkspaceMcpHelpers> = {},
): WorkspaceMcpHelpers {
  return {
    resolveAgentWorkspacePrefix: vi.fn(async () => PREFIX),
    listWorkspaceMcpSlugs: vi.fn(async () => Object.keys(entries)),
    readMcpAssignmentState: vi.fn(async (_prefix: string, slug: string) =>
      slug in entries ? entries[slug] : null,
    ),
    ...over,
  };
}

function state(over: Partial<McpAssignmentState> = {}): McpAssignmentState {
  return {
    slug: "test-server",
    name: "Test Server",
    registryServerId: "srv-1",
    updated_at: "2026-07-02T00:00:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRowsForAgent.mockReturnValue([
    { tenant_id: "tenant-1", slug: "agent-x" },
  ]);
  mockRowsForJoin.mockReturnValue([baseRow()]);
  mockRowsForAssignments.mockReturnValue([]);
  mockRowsForUserToken.mockReturnValue([]);
  mockSecretString.mockReturnValue("");
});

describe("buildMcpConfigs — workspace-file resolution (U9b)", () => {
  it("resolves the attached set from files, parity-identical to the DB path", async () => {
    // File path: one attached file → registryServerId srv-1.
    const fileConfigs = await buildMcpConfigs("agent-1", null, "[test]", {
      workspaceMcp: fileStore({ "test-server": state() }),
    });

    // DB path for the SAME registry data: no slug → fallback; server has no
    // assignment row so it is attached-by-default.
    mockRowsForAgent.mockReturnValue([{ tenant_id: "tenant-1", slug: null }]);
    const dbConfigs = await buildMcpConfigs("agent-1", null, "[test]");

    expect(fileConfigs).toEqual([
      {
        name: "test-server",
        url: "https://mcp.example/a",
        transport: "streamable-http",
      },
    ]);
    expect(fileConfigs).toEqual(dbConfigs);
  });

  it("round-trips the enabledTools allowlist into the tool allowlist (parity)", async () => {
    const fileConfigs = await buildMcpConfigs("agent-1", null, "[test]", {
      workspaceMcp: fileStore({
        "test-server": state({ enabledTools: ["opportunities_list"] }),
      }),
    });

    mockRowsForJoin.mockReturnValue([
      baseRow({
        tools: [{ name: "opportunities_list" }, { name: "accounts_list" }],
      }),
    ]);
    const fileConfigsWithAvailable = await buildMcpConfigs(
      "agent-1",
      null,
      "[test]",
      {
        workspaceMcp: fileStore({
          "test-server": state({ enabledTools: ["opportunities_list"] }),
        }),
      },
    );

    expect(fileConfigs[0]).toMatchObject({ tools: ["opportunities_list"] });
    expect(fileConfigsWithAvailable[0]).toMatchObject({
      tools: ["opportunities_list"],
      availableTools: ["opportunities_list", "accounts_list"],
    });
  });

  it("logs a structured source=workspace-file line when files serve resolution", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await buildMcpConfigs("agent-1", null, "[test]", {
      workspaceMcp: fileStore({ "test-server": state() }),
    });
    const line = log.mock.calls
      .map((call) => String(call[0]))
      .find((msg) => msg.includes("mcp attachment resolution"));
    expect(line).toContain("source=workspace-file");
    expect(line).toContain("agentId=agent-1");
    expect(line).toContain("servers=1");
    log.mockRestore();
  });

  it("excludes a server whose file is marked enabled:false", async () => {
    const configs = await buildMcpConfigs("agent-1", null, "[test]", {
      workspaceMcp: fileStore({
        "test-server": state({ enabled: false }),
      }),
    });
    expect(configs).toEqual([]);
  });

  it("tolerates a file whose registryServerId is not an approved server (skip + log)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const configs = await buildMcpConfigs("agent-1", null, "[test]", {
      workspaceMcp: fileStore({
        "ghost-server": state({
          slug: "ghost-server",
          registryServerId: "srv-unknown",
        }),
      }),
    });
    expect(configs).toEqual([]);
    // Still the file source (not a fallback) — the file listing was non-empty.
    const line = log.mock.calls
      .map((call) => String(call[0]))
      .find((msg) => msg.includes("mcp attachment resolution"));
    expect(line).toContain("source=workspace-file");
    expect(
      warn.mock.calls.some((call) =>
        String(call[0]).includes("not an approved+enabled tenant server"),
      ),
    ).toBe(true);
    warn.mockRestore();
    log.mockRestore();
  });

  it("tolerates an unreadable file (skip + log, not fatal)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const configs = await buildMcpConfigs("agent-1", null, "[test]", {
      workspaceMcp: fileStore({ "test-server": null }),
    });
    expect(configs).toEqual([]);
    expect(
      warn.mock.calls.some((call) =>
        String(call[0]).includes("assignment file unreadable"),
      ),
    ).toBe(true);
    warn.mockRestore();
  });

  it("falls back to the DB path (byte-identical) when the file listing is empty", async () => {
    // A server WITH an assignment override, to make the DB path meaningful.
    mockRowsForAssignments.mockReturnValue([
      { mcp_server_id: "srv-1", enabled: true, config: null },
    ]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const configs = await buildMcpConfigs("agent-1", null, "[test]", {
      workspaceMcp: fileStore({}),
    });
    expect(configs).toEqual([
      {
        name: "test-server",
        url: "https://mcp.example/a",
        transport: "streamable-http",
      },
    ]);
    const line = log.mock.calls
      .map((call) => String(call[0]))
      .find((msg) => msg.includes("mcp attachment resolution"));
    expect(line).toContain("source=database");
    expect(line).toContain("fallbackReason=no-attachment-files");
    log.mockRestore();
  });

  it("falls back to the DB path when the workspace is unavailable (S3 null)", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const configs = await buildMcpConfigs("agent-1", null, "[test]", {
      workspaceMcp: fileStore(
        {},
        { listWorkspaceMcpSlugs: vi.fn(async () => null) },
      ),
    });
    expect(configs).toHaveLength(1);
    const line = log.mock.calls
      .map((call) => String(call[0]))
      .find((msg) => msg.includes("mcp attachment resolution"));
    expect(line).toContain("source=database");
    expect(line).toContain("fallbackReason=workspace-unavailable");
    log.mockRestore();
  });

  it("resolves a fresh plugin server via its file when the agent already has other mcp/ files (Composer U9 regression)", async () => {
    // The exact dropped-server scenario: an agent already has server-a's file
    // (non-empty listing → file path wins, no DB fallback). A plugin install
    // adds server-b to the approved registry. WITHOUT server-b's file (the
    // pre-fix bug) it drops; WITH it (the parity fix materializes it) both
    // resolve.
    const serverA = baseRow({
      mcp_server_id: "srv-a",
      slug: "server-a",
      name: "Server A",
      url: "https://mcp.example/a",
    });
    const serverPlugin = baseRow({
      mcp_server_id: "srv-plugin",
      slug: "lastmile--crm",
      name: "LastMile CRM",
      url: "https://mcp.example/plugin",
      management_source: "plugin",
      plugin_install_id: "install-1",
    });
    mockRowsForJoin.mockReturnValue([serverA, serverPlugin]);

    // Pre-fix: only server-a has a file → plugin server DROPS.
    const dropped = await buildMcpConfigs("agent-1", null, "[test]", {
      workspaceMcp: fileStore({
        "server-a": state({ slug: "server-a", registryServerId: "srv-a" }),
      }),
    });
    expect(dropped.map((c) => c.name)).toEqual(["server-a"]);

    // Post-fix: the parity code materialized the plugin file too → both attach.
    const fixed = await buildMcpConfigs("agent-1", null, "[test]", {
      workspaceMcp: fileStore({
        "server-a": state({ slug: "server-a", registryServerId: "srv-a" }),
        "lastmile--crm": state({
          slug: "lastmile--crm",
          name: "LastMile CRM",
          registryServerId: "srv-plugin",
        }),
      }),
    });
    expect(fixed.map((c) => c.name).sort()).toEqual([
      "lastmile--crm",
      "server-a",
    ]);
  });

  it("falls back without loading the store when the agent has no slug", async () => {
    mockRowsForAgent.mockReturnValue([{ tenant_id: "tenant-1", slug: null }]);
    const helpers = fileStore({ "test-server": state() });
    const configs = await buildMcpConfigs("agent-1", null, "[test]", {
      workspaceMcp: helpers,
    });
    expect(configs).toHaveLength(1);
    // The gate short-circuits before touching the store.
    expect(helpers.resolveAgentWorkspacePrefix).not.toHaveBeenCalled();
    expect(helpers.listWorkspaceMcpSlugs).not.toHaveBeenCalled();
  });
});
