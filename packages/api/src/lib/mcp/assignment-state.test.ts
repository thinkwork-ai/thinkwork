/**
 * MCP workspace assignment-state file tests (Composer plan U9a).
 *
 * Contract: references-only manifests (NEVER tokens), fail-soft reads,
 * never-throw writes (the agent_mcp_servers row stays authoritative until
 * U9b), and an idempotent write-if-absent backfill reconcile.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, dbRows, putSpy } = vi.hoisted(() => ({
  store: new Map<string, string>(),
  dbRows: { attached: [] as unknown[], registry: [] as unknown[] },
  putSpy: vi.fn<(key: string) => void>(),
}));

// db is only touched by materialize/reconcile. materialize reads the
// registry row; reconcile reads the attached set via innerJoin.
vi.mock("../../graphql/utils.js", () => {
  const registryChain = {
    from: () => ({
      where: () => ({ limit: () => Promise.resolve(dbRows.registry) }),
    }),
  };
  const attachedChain = {
    from: () => ({
      innerJoin: () => ({ where: () => Promise.resolve(dbRows.attached) }),
    }),
  };
  return {
    db: {
      // materialize selects the registry row (chain ends in .limit);
      // reconcile selects the attached set (chain has .innerJoin). Each
      // test exercises exactly one, so route by which rows are staged.
      select: () => (dbRows.registry.length ? registryChain : attachedChain),
    },
    eq: vi.fn(),
    and: vi.fn(),
    agents: {},
    tenants: {},
    tenantMcpServers: {},
  };
});

vi.mock("@thinkwork/database-pg/schema", () => ({ agentMcpServers: {} }));

vi.mock("@thinkwork/runtime-config", () => ({
  getConfig: () => "workspace-bucket",
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

// The fake client branches on the command's constructor name (the mock
// classes above), so it needs no reference to the hoisted class bindings.
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
        store.delete(command.input.Key!);
        return {};
      default: {
        // ListObjectsV2Command
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
  buildMcpAssignmentState,
  listWorkspaceMcpSlugs,
  mcpAssignmentStateKey,
  materializeMcpAssignmentFolder,
  readMcpAssignmentState,
  reconcileMcpAssignmentFolders,
  removeMcpAssignmentFolder,
  writeMcpAssignmentState,
} from "./assignment-state.js";

const PREFIX = "tenants/acme/agents/ada/";
const DEPS = { s3: fakeS3 as never, bucket: "workspace-bucket" };

beforeEach(() => {
  store.clear();
  putSpy.mockClear();
  dbRows.attached = [];
  dbRows.registry = [];
});

describe("buildMcpAssignmentState (references only — no secrets)", () => {
  it("carries slug/name/registry ref/authType/secretRef/enabledTools", () => {
    const state = buildMcpAssignmentState({
      registry: {
        id: "srv-1",
        slug: "github",
        name: "GitHub",
        transport: "streamable-http",
        auth_type: "tenant_api_key",
        auth_config: { secretRef: "arn:aws:secretsmanager:...:github" },
      },
      agentConfig: { toolAllowlist: ["issues_read", "pulls_read"] },
      now: new Date("2026-07-02T00:00:00.000Z"),
    });
    expect(state).toEqual({
      slug: "github",
      name: "GitHub",
      registryServerId: "srv-1",
      transport: "streamable-http",
      authType: "tenant_api_key",
      secretRef: "arn:aws:secretsmanager:...:github",
      enabledTools: ["issues_read", "pulls_read"],
      updated_at: "2026-07-02T00:00:00.000Z",
    });
  });

  it("NEVER copies token-like fields from auth_config — only secretRef is read", () => {
    const state = buildMcpAssignmentState({
      registry: {
        id: "srv-2",
        slug: "leaky",
        name: "Leaky",
        auth_type: "tenant_api_key",
        auth_config: {
          secretRef: "arn:secret",
          // Hostile inline credentials that must never reach the file:
          apiKey: "sk-live-DO-NOT-LEAK",
          token: "tok-DO-NOT-LEAK",
          accessToken: "at-DO-NOT-LEAK",
          password: "hunter2",
          bearer: "bearer-DO-NOT-LEAK",
        },
      },
    });
    const serialized = JSON.stringify(state);
    for (const secret of [
      "sk-live-DO-NOT-LEAK",
      "tok-DO-NOT-LEAK",
      "at-DO-NOT-LEAK",
      "hunter2",
      "bearer-DO-NOT-LEAK",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    // Only the reference survives.
    expect(state.secretRef).toBe("arn:secret");
    expect(Object.keys(state).sort()).toEqual(
      [
        "authType",
        "name",
        "registryServerId",
        "secretRef",
        "slug",
        "updated_at",
      ].sort(),
    );
  });

  it("omits secretRef/enabledTools for a none-auth server with no allowlist", () => {
    const state = buildMcpAssignmentState({
      registry: { id: "srv-3", slug: "docs", name: "Docs", auth_type: "none" },
    });
    expect(state.secretRef).toBeUndefined();
    expect(state.enabledTools).toBeUndefined();
    expect(state.authType).toBe("none");
  });
});

describe("write/read/list/remove", () => {
  it("writes the manifest at mcp/<slug>/.assignment.json and reads it back", async () => {
    const state = buildMcpAssignmentState({
      registry: {
        id: "srv-1",
        slug: "github",
        name: "GitHub",
        auth_type: "none",
      },
    });
    expect(await writeMcpAssignmentState(PREFIX, state, DEPS)).toBe(true);
    expect(store.has(mcpAssignmentStateKey(PREFIX, "github"))).toBe(true);
    const read = await readMcpAssignmentState(PREFIX, "github", DEPS);
    expect(read).toMatchObject({ slug: "github", registryServerId: "srv-1" });
  });

  it("lists attached slugs from .assignment.json markers", async () => {
    store.set(mcpAssignmentStateKey(PREFIX, "github"), "{}");
    store.set(mcpAssignmentStateKey(PREFIX, "slack"), "{}");
    // A stray file in the folder that is not a marker is ignored.
    store.set(`${PREFIX}mcp/github/README.md`, "hi");
    expect(await listWorkspaceMcpSlugs(PREFIX, DEPS)).toEqual([
      "github",
      "slack",
    ]);
  });

  it("remove deletes the whole mcp/<slug>/ prefix", async () => {
    store.set(mcpAssignmentStateKey(PREFIX, "github"), "{}");
    store.set(`${PREFIX}mcp/github/extra.json`, "{}");
    store.set(mcpAssignmentStateKey(PREFIX, "slack"), "{}");
    expect(await removeMcpAssignmentFolder(PREFIX, "github", DEPS)).toBe(true);
    expect(store.has(mcpAssignmentStateKey(PREFIX, "github"))).toBe(false);
    expect(store.has(`${PREFIX}mcp/github/extra.json`)).toBe(false);
    // Sibling untouched.
    expect(store.has(mcpAssignmentStateKey(PREFIX, "slack"))).toBe(true);
  });

  it("reads fail soft: absent file → null", async () => {
    expect(await readMcpAssignmentState(PREFIX, "missing", DEPS)).toBeNull();
  });
});

describe("materializeMcpAssignmentFolder (grant target)", () => {
  it("reads the registry row and writes the manifest", async () => {
    dbRows.registry = [
      {
        id: "srv-1",
        slug: "github",
        name: "GitHub",
        transport: "streamable-http",
        auth_type: "oauth",
        auth_config: null,
      },
    ];
    const ok = await materializeMcpAssignmentFolder(
      {
        targetPrefix: PREFIX,
        registryServerId: "srv-1",
        tenantId: "t-1",
        agentConfig: { toolAllowlist: ["a"] },
      },
      DEPS,
    );
    expect(ok).toBe(true);
    const read = await readMcpAssignmentState(PREFIX, "github", DEPS);
    expect(read).toMatchObject({ slug: "github", enabledTools: ["a"] });
  });
});

describe("reconcileMcpAssignmentFolders (backfill, write-if-absent)", () => {
  it("materializes files for existing attachments and no-ops on second run", async () => {
    dbRows.attached = [
      {
        registryId: "srv-1",
        slug: "github",
        name: "GitHub",
        transport: "streamable-http",
        auth_type: "none",
        auth_config: null,
        config: null,
        enabled: true,
      },
      {
        registryId: "srv-2",
        slug: "slack",
        name: "Slack",
        transport: "streamable-http",
        auth_type: "tenant_api_key",
        auth_config: { secretRef: "arn:slack" },
        config: { toolAllowlist: ["post"] },
        enabled: true,
      },
    ];

    const first = await reconcileMcpAssignmentFolders(
      { agentId: "agent-1", tenantId: "t-1", targetPrefix: PREFIX },
      DEPS,
    );
    expect(first).toBe(2);
    expect(await listWorkspaceMcpSlugs(PREFIX, DEPS)).toEqual([
      "github",
      "slack",
    ]);
    const slack = await readMcpAssignmentState(PREFIX, "slack", DEPS);
    expect(slack).toMatchObject({
      secretRef: "arn:slack",
      enabledTools: ["post"],
    });

    putSpy.mockClear();
    const second = await reconcileMcpAssignmentFolders(
      { agentId: "agent-1", tenantId: "t-1", targetPrefix: PREFIX },
      DEPS,
    );
    expect(second).toBe(0);
    expect(putSpy).not.toHaveBeenCalled();
  });
});
