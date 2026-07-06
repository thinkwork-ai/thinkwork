/**
 * MCP assignment-folder helpers for the non-Composer writers
 * (post-retirement: the workspace files ARE the assignment state).
 *
 * Contract under test:
 *  - `materializeMcpAssignmentFoldersForAgents` writes one server's
 *    `.assignment.json` per agent from the REGISTRY row alone (no
 *    assignment-table read — the table is retired), and is bucket-gated.
 *  - `snapshotMcpServerAttachment` returns {slug, agentIds} where agentIds
 *    is ALL tenant agents (removal is a no-op for agents without the
 *    folder), and returns null (no DB read) with no workspace bucket.
 *  - `removeMcpAssignmentFoldersForAgents` / `removeMcpAssignmentForAgentServer`
 *    delete the per-agent `mcp/<slug>/` folders.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, state, putSpy, deleteSpy, bucketRef, TABLES } = vi.hoisted(
  () => ({
    store: new Map<string, string>(),
    TABLES: {
      AGENTS: { __table: "agents" },
      TENANTS: { __table: "tenants" },
      TENANT_MCP: { __table: "tenantMcpServers" },
    },
    state: {
      // resolveAgentWorkspacePrefix reads agents then tenants.
      agent: {
        slug: "ada",
        workspace_folder_name: null as string | null,
        tenant_id: "t-1",
      },
      tenant: { slug: "acme" },
      // resolveMcpServerSlug + materialize read the registry row.
      server: {
        id: "srv-1",
        slug: "github",
        name: "GitHub",
        transport: "streamable-http",
        auth_type: "none",
        auth_config: null,
      } as {
        id: string;
        slug: string | null;
        name: string;
        transport: string | null;
        auth_type: string | null;
        auth_config: unknown;
      } | null,
      // snapshot enumerates the tenant's agents (terminal where).
      tenantAgentIds: [] as string[],
    },
    putSpy: vi.fn<(key: string) => void>(),
    deleteSpy: vi.fn<(key: string) => void>(),
    bucketRef: { value: "workspace-bucket" as string | null },
  }),
);

function limitFor(table: unknown): unknown[] {
  if (table === TABLES.AGENTS) return [state.agent];
  if (table === TABLES.TENANTS) return [state.tenant];
  if (table === TABLES.TENANT_MCP) return state.server ? [state.server] : [];
  return [];
}
function whereFor(table: unknown): unknown[] {
  if (table === TABLES.AGENTS)
    return state.tenantAgentIds.map((agent_id) => ({ agent_id }));
  return [];
}

vi.mock("../../graphql/utils.js", () => {
  const makeChain = () => {
    let table: unknown;
    const chain: Record<string, unknown> = {
      from(t: unknown) {
        table = t;
        return chain;
      },
      where() {
        return {
          limit: () => Promise.resolve(limitFor(table)),
          then: (res: (v: unknown[]) => void, rej: (e: unknown) => void) =>
            Promise.resolve(whereFor(table)).then(res, rej),
        };
      },
      limit() {
        return Promise.resolve(limitFor(table));
      },
    };
    return chain;
  };
  return {
    db: { select: () => makeChain() },
    eq: vi.fn(),
    and: vi.fn(),
    agents: TABLES.AGENTS,
    tenants: TABLES.TENANTS,
    tenantMcpServers: TABLES.TENANT_MCP,
  };
});

vi.mock("@thinkwork/runtime-config", () => ({
  getConfig: () => bucketRef.value,
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {},
  GetObjectCommand: class {
    constructor(public input: { Bucket: string; Key: string }) {}
  },
  PutObjectCommand: class {
    constructor(public input: { Bucket: string; Key: string; Body: string }) {}
  },
  DeleteObjectCommand: class {
    constructor(public input: { Bucket: string; Key: string }) {}
  },
  ListObjectsV2Command: class {
    constructor(public input: { Bucket: string; Prefix: string }) {}
  },
}));

const fakeS3 = {
  async send(command: {
    constructor: { name: string };
    input: { Key?: string; Prefix?: string; Body?: string };
  }) {
    switch (command.constructor.name) {
      case "PutObjectCommand":
        putSpy(command.input.Key!);
        store.set(command.input.Key!, command.input.Body!);
        return {};
      case "GetObjectCommand": {
        const body = store.get(command.input.Key!);
        if (body === undefined) {
          const err = new Error("no such key");
          (err as { name: string }).name = "NoSuchKey";
          throw err;
        }
        return { Body: { transformToString: async () => body } };
      }
      case "DeleteObjectCommand":
        deleteSpy(command.input.Key!);
        store.delete(command.input.Key!);
        return {};
      default: {
        const prefix = command.input.Prefix!;
        const Contents = [...store.keys()]
          .filter((key) => key.startsWith(prefix))
          .map((Key) => ({ Key }));
        return { Contents, IsTruncated: false };
      }
    }
  },
} as unknown;

import {
  mcpAssignmentStateKey,
  materializeMcpAssignmentFoldersForAgents,
  removeMcpAssignmentForAgentServer,
  removeMcpAssignmentFoldersForAgents,
  snapshotMcpServerAttachment,
} from "./assignment-state.js";

const DEPS = { s3: fakeS3 as never, bucket: "workspace-bucket" };
const ADA = "tenants/acme/agents/ada/";

beforeEach(() => {
  store.clear();
  putSpy.mockClear();
  deleteSpy.mockClear();
  state.agent = { slug: "ada", workspace_folder_name: null, tenant_id: "t-1" };
  state.tenant = { slug: "acme" };
  state.server = {
    id: "srv-1",
    slug: "github",
    name: "GitHub",
    transport: "streamable-http",
    auth_type: "none",
    auth_config: null,
  };
  state.tenantAgentIds = [];
  bucketRef.value = "workspace-bucket";
});

describe("materializeMcpAssignmentFoldersForAgents (attach)", () => {
  it("writes the server's .assignment.json for each agent from the registry row", async () => {
    const written = await materializeMcpAssignmentFoldersForAgents(
      { agentIds: ["agent-1"], tenantId: "t-1", registryServerId: "srv-1" },
      DEPS,
    );

    expect(written).toBe(1);
    const key = mcpAssignmentStateKey(ADA, "github");
    expect(store.has(key)).toBe(true);
    const parsed = JSON.parse(store.get(key)!) as {
      slug: string;
      registryServerId: string;
      transport?: string;
    };
    expect(parsed.slug).toBe("github");
    expect(parsed.registryServerId).toBe("srv-1");
    expect(parsed.transport).toBe("streamable-http");
  });

  it("is bucket-gated: no bucket → no DB read, no writes", async () => {
    bucketRef.value = null;
    const written = await materializeMcpAssignmentFoldersForAgents(
      { agentIds: ["agent-1"], tenantId: "t-1", registryServerId: "srv-1" },
      // No bucket in deps either — falls through to workspaceBucket() → null.
      { s3: fakeS3 as never },
    );
    expect(written).toBe(0);
    expect(putSpy).not.toHaveBeenCalled();
  });

  it("returns 0 when the registry row is gone", async () => {
    state.server = null;
    const written = await materializeMcpAssignmentFoldersForAgents(
      { agentIds: ["agent-1"], tenantId: "t-1", registryServerId: "srv-x" },
      DEPS,
    );
    expect(written).toBe(0);
  });
});

describe("snapshotMcpServerAttachment", () => {
  it("returns the server slug + ALL tenant agent ids (folder removal is idempotent)", async () => {
    state.tenantAgentIds = ["agent-1", "agent-2"];
    const snap = await snapshotMcpServerAttachment(
      { tenantId: "t-1", registryServerId: "srv-1" },
      DEPS,
    );
    expect(snap).toEqual({ slug: "github", agentIds: ["agent-1", "agent-2"] });
  });

  it("returns null (no DB read) when no workspace bucket is configured", async () => {
    bucketRef.value = null;
    const snap = await snapshotMcpServerAttachment(
      { tenantId: "t-1", registryServerId: "srv-1" },
      { s3: fakeS3 as never },
    );
    expect(snap).toBeNull();
  });
});

describe("removeMcpAssignmentFoldersForAgents (server teardown)", () => {
  it("removes each agent's mcp/<slug>/ folder", async () => {
    store.set(mcpAssignmentStateKey(ADA, "github"), "{}");
    store.set(`${ADA}mcp/github/extra.json`, "{}");
    // Sibling that must survive.
    store.set(mcpAssignmentStateKey(ADA, "slack"), "{}");

    const removed = await removeMcpAssignmentFoldersForAgents(
      { agentIds: ["agent-1"], slug: "github" },
      DEPS,
    );

    expect(removed).toBe(1);
    expect(store.has(mcpAssignmentStateKey(ADA, "github"))).toBe(false);
    expect(store.has(`${ADA}mcp/github/extra.json`)).toBe(false);
    expect(store.has(mcpAssignmentStateKey(ADA, "slack"))).toBe(true);
  });
});

describe("removeMcpAssignmentForAgentServer (single-agent detach)", () => {
  it("resolves the slug from the registry and removes the folder", async () => {
    store.set(mcpAssignmentStateKey(ADA, "github"), "{}");
    const ok = await removeMcpAssignmentForAgentServer(
      { agentId: "agent-1", registryServerId: "srv-1" },
      DEPS,
    );
    expect(ok).toBe(true);
    expect(deleteSpy).toHaveBeenCalledWith(
      mcpAssignmentStateKey(ADA, "github"),
    );
    expect(store.has(mcpAssignmentStateKey(ADA, "github"))).toBe(false);
  });

  it("no-ops when the server row is gone (slug unresolvable)", async () => {
    state.server = null;
    const ok = await removeMcpAssignmentForAgentServer(
      { agentId: "agent-1", registryServerId: "srv-gone" },
      DEPS,
    );
    expect(ok).toBe(false);
  });
});
