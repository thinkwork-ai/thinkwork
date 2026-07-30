/**
 * attachServerToPlatformDefaultAgents — the Settings → Connectors
 * auto-attach helper. Pins: (1) only platform-default agents are targeted,
 * (2) the connection folder is written from the registry row for each of
 * them, (3) a pending, disabled, or missing row writes nothing —
 * including the legacy materialization, which has no guard of its own, (4) a tenant with no platform-default agent is
 * a clean no-op.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbState, resetDbState, mockPutFolder, mockMaterialize } = vi.hoisted(
  () => {
    type DbState = {
      agentRows: Array<{ id: string }>;
      serverRows: Array<Record<string, unknown>>;
    };
    const dbState: DbState = { agentRows: [], serverRows: [] };
    return {
      dbState,
      resetDbState: () => {
        dbState.agentRows = [];
        dbState.serverRows = [];
      },
      mockPutFolder: vi.fn(async (_input: unknown) => ({ ok: true as const })),
      mockMaterialize: vi.fn(async () => 0),
    };
  },
);

vi.mock("../../graphql/utils.js", () => ({
  db: {
    select: () => ({
      from: (table: { __table?: string }) => ({
        where: () => {
          const rows =
            table.__table === "agents" ? dbState.agentRows : dbState.serverRows;
          const promise = Promise.resolve(rows) as Promise<unknown[]> & {
            limit: (n: number) => Promise<unknown[]>;
          };
          promise.limit = async () => rows;
          return promise;
        },
      }),
    }),
  },
  eq: (..._args: unknown[]) => ({ _eq: _args }),
  and: (..._args: unknown[]) => ({ _and: _args }),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  agents: {
    __table: "agents",
    id: "agents.id",
    tenant_id: "t",
    is_platform_default: "d",
  },
  tenantMcpServers: {
    __table: "tenant_mcp_servers",
    id: "id",
    tenant_id: "tenant_id",
    slug: "slug",
    name: "name",
    url: "url",
    transport: "transport",
    tools: "tools",
    status: "status",
    enabled: "enabled",
  },
}));

vi.mock("../skills/assignment-state.js", () => ({
  resolveAgentWorkspacePrefix: vi.fn(
    async (agentId: string) => `tenants/tenant-1/agents/${agentId}`,
  ),
}));

vi.mock("../mcp/assignment-state.js", () => ({
  materializeMcpAssignmentFoldersForAgents: mockMaterialize,
}));

vi.mock("./folder-write.js", () => ({
  connectionDefinitionFromRegistryRow: vi.fn(
    (row: { slug: string | null; name: string }) => ({
      slug: row.slug ?? row.name,
      definition: { kind: "mcp" },
    }),
  ),
  putCapabilityFolder: mockPutFolder,
  removeCapabilityFolder: vi.fn(async () => ({ ok: true as const })),
}));

vi.mock("../entity-identity/routing-map-file.js", () => ({
  refreshRoutingMapFile: vi.fn(async () => undefined),
}));

vi.mock("../ontology/twin-export.js", () => ({
  regenerateTwinMappingExport: vi.fn(async () => undefined),
}));

import { attachServerToPlatformDefaultAgents } from "./reconcile-connection-folders.js";

const TENANT = "tenant-1";
const SERVER = "server-1";

function approvedServerRow(): Record<string, unknown> {
  return {
    server_id: SERVER,
    slug: "company-brain",
    name: "Company Brain",
    url: "https://mcp.example.com/mcp",
    transport: "streamable-http",
    tools: null,
    status: "approved",
    // Both column spellings: the attach guard selects `enabled`, the
    // folder writer aliases the same column to `server_enabled`.
    enabled: true,
    server_enabled: true,
  };
}

beforeEach(() => {
  resetDbState();
  vi.clearAllMocks();
});

describe("attachServerToPlatformDefaultAgents", () => {
  it("writes the connection folder for each platform-default agent", async () => {
    dbState.agentRows = [{ id: "agent-1" }, { id: "agent-2" }];
    dbState.serverRows = [approvedServerRow()];

    await attachServerToPlatformDefaultAgents({
      tenantId: TENANT,
      registryServerId: SERVER,
      signedBy: "plugin-reconciler",
      deps: { bucket: "test-bucket" },
    });

    expect(mockMaterialize).toHaveBeenCalledWith({
      agentIds: ["agent-1", "agent-2"],
      tenantId: TENANT,
      registryServerId: SERVER,
    });
    expect(mockPutFolder).toHaveBeenCalledTimes(2);
    expect(mockPutFolder.mock.calls.map(([input]) => input)).toEqual([
      expect.objectContaining({
        targetPrefix: "tenants/tenant-1/agents/agent-1",
        klass: "connection",
        slug: "company-brain",
        signedBy: "plugin-reconciler",
      }),
      expect.objectContaining({
        targetPrefix: "tenants/tenant-1/agents/agent-2",
      }),
    ]);
  });

  it("writes nothing for a pending row (approved+enabled guard)", async () => {
    dbState.agentRows = [{ id: "agent-1" }];
    dbState.serverRows = [{ ...approvedServerRow(), status: "pending" }];

    await attachServerToPlatformDefaultAgents({
      tenantId: TENANT,
      registryServerId: SERVER,
      signedBy: "plugin-reconciler",
      deps: { bucket: "test-bucket" },
    });

    expect(mockMaterialize).not.toHaveBeenCalled();
    expect(mockPutFolder).not.toHaveBeenCalled();
  });

  it("writes nothing for a disabled row", async () => {
    dbState.agentRows = [{ id: "agent-1" }];
    dbState.serverRows = [
      { ...approvedServerRow(), enabled: false, server_enabled: false },
    ];

    await attachServerToPlatformDefaultAgents({
      tenantId: TENANT,
      registryServerId: SERVER,
      signedBy: "plugin-reconciler",
      deps: { bucket: "test-bucket" },
    });

    expect(mockMaterialize).not.toHaveBeenCalled();
    expect(mockPutFolder).not.toHaveBeenCalled();
  });

  it("writes nothing when the registry row is missing", async () => {
    dbState.agentRows = [{ id: "agent-1" }];
    dbState.serverRows = [];

    await attachServerToPlatformDefaultAgents({
      tenantId: TENANT,
      registryServerId: SERVER,
      signedBy: "plugin-reconciler",
      deps: { bucket: "test-bucket" },
    });

    expect(mockMaterialize).not.toHaveBeenCalled();
    expect(mockPutFolder).not.toHaveBeenCalled();
  });

  it("no-ops for a tenant with no platform-default agent", async () => {
    dbState.serverRows = [approvedServerRow()];

    await attachServerToPlatformDefaultAgents({
      tenantId: TENANT,
      registryServerId: SERVER,
      signedBy: "plugin-reconciler",
      deps: { bucket: "test-bucket" },
    });

    expect(mockMaterialize).not.toHaveBeenCalled();
    expect(mockPutFolder).not.toHaveBeenCalled();
  });
});
