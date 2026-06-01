import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  mkdir,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  WorkspaceAccessRevalidationError,
  WorkspaceBoundaryError,
  WorkspaceCache,
  type WorkspaceObjectStore,
} from "../../src/sidecar/workspace-cache";

const PARTITION = {
  stage: "dev",
  tenantSlug: "acme",
  agentSlug: "marco",
  spaceId: "space-1",
  userId: "user-1",
};

class FakeStore implements WorkspaceObjectStore {
  listCalls = 0;
  getCalls = 0;
  failList = false;

  constructor(private readonly files: Record<string, string>) {}

  setFile(key: string, value: string): void {
    this.files[key] = value;
  }

  async listObjects(input: {
    bucket: string;
    prefix: string;
  }): Promise<Array<{ key: string }>> {
    this.listCalls++;
    if (this.failList) throw new Error("offline");
    expect(input.bucket).toBe("workspace-bucket");
    return Object.keys(this.files)
      .filter((key) => key.startsWith(input.prefix))
      .map((key) => ({
        key,
        eTag: `fake-${this.files[key]}`,
        size: new TextEncoder().encode(this.files[key]).byteLength,
      }));
  }

  async getObjectBytes(input: {
    bucket: string;
    key: string;
  }): Promise<Uint8Array> {
    this.getCalls++;
    expect(input.bucket).toBe("workspace-bucket");
    return new TextEncoder().encode(this.files[input.key] ?? "");
  }
}

describe("WorkspaceCache", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "thinkwork-pi-cache-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("syncs only approved workspace prefixes and removes stale files", async () => {
    const prefix = "tenants/acme/agents/marco/";
    const cache = new WorkspaceCache(
      root,
      new FakeStore({
        [`${prefix}AGENTS.md`]: "# Agent",
        [`${prefix}space/SPACE.md`]: "# Space",
        [`${prefix}manifest.json`]: "{}",
      }),
    );
    const localDir = cache.partitionPath(PARTITION);
    await mkdir(localDir, { recursive: true });
    await writeFile(join(localDir, "stale.md"), "stale");

    const result = await cache.sync({
      bucket: "workspace-bucket",
      renderedPrefix: prefix,
      partition: PARTITION,
    });

    expect(result).toMatchObject({
      prefix,
      synced: 2,
      deleted: 1,
      total: 2,
    });
    await expect(readFile(join(localDir, "AGENTS.md"), "utf8")).resolves.toBe(
      "# Agent",
    );
    await expect(
      readFile(join(localDir, "space/SPACE.md"), "utf8"),
    ).resolves.toBe("# Space");
    await expect(
      readFile(join(localDir, "stale.md"), "utf8"),
    ).rejects.toThrow();
  });

  it("hydrates rendered thread manifests into the v1 workspace tree", async () => {
    const prefix = "tenants/acme/threads/customer-kickoff/";
    const manifest = {
      version: 1,
      renderedPrefix: prefix,
      generatedAt: "2026-05-31T18:00:00.000Z",
      sources: [
        { owner: "agent", prefix: "tenants/acme/agents/marco/" },
        { owner: "space", prefix: "tenants/acme/spaces/default/" },
        { owner: "user", prefix: "tenants/acme/users/eric-odom/" },
      ],
      files: [
        {
          path: "AGENTS.md",
          owner: "agent",
          sourceKey: "tenants/acme/agents/marco/AGENTS.md",
          sourcePrefix: "tenants/acme/agents/marco/",
          sourcePath: "AGENTS.md",
          etag: '"agent"',
          readOnly: false,
        },
        {
          path: "Spaces/INDEX.md",
          owner: "thread_goal",
          sourceKey: `${prefix}Spaces/INDEX.md`,
          sourcePrefix: prefix,
          sourcePath: "Spaces/INDEX.md",
          etag: '"space-index"',
          readOnly: true,
          generated: true,
        },
        {
          path: "Spaces/default/CONTEXT.md",
          owner: "space",
          sourceKey: "tenants/acme/spaces/default/CONTEXT.md",
          sourcePrefix: "tenants/acme/spaces/default/",
          sourcePath: "CONTEXT.md",
          etag: '"space"',
          readOnly: false,
        },
        {
          path: "User/USER.md",
          owner: "user",
          sourceKey: "tenants/acme/users/eric-odom/USER.md",
          sourcePrefix: "tenants/acme/users/eric-odom/",
          sourcePath: "USER.md",
          etag: '"user"',
          readOnly: false,
        },
      ],
      statusMounts: [],
    };
    const cache = new WorkspaceCache(
      root,
      new FakeStore({
        [`${prefix}.hydrate_manifest.json`]: `${JSON.stringify(manifest)}\n`,
        [`${prefix}Spaces/INDEX.md`]: "# Spaces",
        "tenants/acme/agents/marco/AGENTS.md": "# Agent",
        "tenants/acme/agents/marco/skills/report/SKILL.md": "# Skill",
        "tenants/acme/agents/marco/workspace/LEGACY.md": "# Legacy",
        "tenants/acme/agents/marco/SPACE_CONTEXT.md": "# Stale Space",
        "tenants/acme/agents/marco/spaces/old/SPACE.md": "# Old Space",
        "tenants/acme/spaces/default/CONTEXT.md": "# Space",
        "tenants/acme/spaces/default/source/LEGACY.md": "# Legacy Space",
        "tenants/acme/spaces/default/TOOLS.md": "# Space Tools",
        "tenants/acme/spaces/support/CONTEXT.md": "# Support",
        "tenants/acme/users/eric-odom/USER.md": "# User",
      }),
    );
    const oldNestedDir = join(
      root,
      "dev",
      "acme",
      "marco",
      "space-uuid",
      "user-uuid",
    );
    await mkdir(oldNestedDir, { recursive: true });
    await writeFile(join(oldNestedDir, "stale.md"), "stale");

    const result = await cache.sync({
      bucket: "workspace-bucket",
      renderedPrefix: prefix,
      partition: PARTITION,
    });

    expect(result.localDir).toBe(root);
    expect(result).toMatchObject({ prefix, synced: 6, total: 6 });
    await expect(readFile(join(root, "AGENTS.md"), "utf8")).resolves.toBe(
      "# Agent",
    );
    await expect(
      readFile(join(root, "skills/report/SKILL.md"), "utf8"),
    ).resolves.toBe("# Skill");
    await expect(
      readFile(join(root, "Agent/workspace/AGENTS.md"), "utf8"),
    ).rejects.toThrow();
    await expect(readFile(join(root, "Spaces/INDEX.md"), "utf8")).resolves.toBe(
      "# Spaces",
    );
    await expect(
      readFile(join(root, "Spaces/default/CONTEXT.md"), "utf8"),
    ).resolves.toBe("# Space");
    await expect(
      readFile(join(root, "Spaces/support/CONTEXT.md"), "utf8"),
    ).rejects.toThrow();
    await expect(
      readFile(join(root, "Spaces/default/source/CONTEXT.md"), "utf8"),
    ).rejects.toThrow();
    await expect(
      readFile(join(root, "SPACE_CONTEXT.md"), "utf8"),
    ).rejects.toThrow();
    await expect(
      readFile(join(root, "spaces/old/SPACE.md"), "utf8"),
    ).rejects.toThrow();
    await expect(
      readFile(join(root, "Spaces/default/TOOLS.md"), "utf8"),
    ).rejects.toThrow();
    await expect(readFile(join(root, "User/USER.md"), "utf8")).resolves.toBe(
      "# User",
    );
    await expect(
      readFile(join(oldNestedDir, "stale.md"), "utf8"),
    ).rejects.toThrow();
    await expect(rootDirectoryNames(root)).resolves.toEqual([
      "Spaces",
      "User",
      "skills",
    ]);
  });

  it("does not create empty tuple roots when some sources are empty", async () => {
    const prefix = "tenants/acme/threads/customer-kickoff/";
    const manifest = {
      version: 1,
      renderedPrefix: prefix,
      generatedAt: "2026-05-31T18:00:00.000Z",
      sources: [
        { owner: "agent", prefix: "tenants/acme/agents/marco/" },
        { owner: "space", prefix: "tenants/acme/spaces/default/" },
        { owner: "user", prefix: "tenants/acme/users/eric-odom/" },
      ],
      files: [
        {
          path: "Agent/AGENTS.md",
          owner: "agent",
          sourceKey: "tenants/acme/agents/marco/AGENTS.md",
          sourcePath: "AGENTS.md",
          etag: '"agent"',
        },
      ],
      statusMounts: [
        {
          path: "Spaces/default/GOAL.md",
          sourceKey: null,
          available: false,
        },
      ],
    };
    const cache = new WorkspaceCache(
      root,
      new FakeStore({
        [`${prefix}.hydrate_manifest.json`]: `${JSON.stringify(manifest)}\n`,
        "tenants/acme/agents/marco/AGENTS.md": "# Agent",
      }),
    );
    await mkdir(join(root, "default", "tenant", "agent"), {
      recursive: true,
    });

    await cache.sync({
      bucket: "workspace-bucket",
      renderedPrefix: prefix,
      partition: PARTITION,
    });

    await expect(rootDirectoryNames(root)).resolves.toEqual([]);
  });

  it("ignores retired rendered USER.md prefixes when the user source is empty", async () => {
    const prefix = "tenants/acme/threads/customer-kickoff/";
    const manifest = {
      version: 1,
      renderedPrefix: prefix,
      generatedAt: "2026-05-31T18:30:00.000Z",
      sources: [
        { owner: "agent", prefix: "tenants/acme/agents/marco/" },
        { owner: "space", prefix: "tenants/acme/spaces/default/" },
        { owner: "user", prefix: "tenants/acme/users/eric-odom/" },
      ],
      files: [
        {
          path: "Agent/AGENTS.md",
          owner: "agent",
          sourceKey: "tenants/acme/agents/marco/AGENTS.md",
          sourcePath: "AGENTS.md",
          etag: '"agent"',
        },
      ],
      statusMounts: [],
    };
    const cache = new WorkspaceCache(
      root,
      new FakeStore({
        [`${prefix}.hydrate_manifest.json`]: `${JSON.stringify(manifest)}\n`,
        "tenants/acme/rendered/marco/default/eric-odom/USER.md":
          "# Legacy rendered user",
        "tenants/acme/rendered/marco/default/eric-odom/memory/MEMORY.md":
          "# Legacy rendered memory",
        "tenants/acme/rendered/marco/default/eric-odom/memory/.snapshots/run-1/MEMORY.md":
          "# Snapshot",
        "tenants/acme/agents/marco/AGENTS.md": "# Agent",
      }),
    );

    const result = await cache.sync({
      bucket: "workspace-bucket",
      renderedPrefix: prefix,
      partition: PARTITION,
    });

    expect(result).toMatchObject({ prefix, synced: 2, total: 2 });
    await expect(
      readFile(join(root, "User/USER.md"), "utf8"),
    ).rejects.toThrow();
    await expect(
      readFile(join(root, "User/memory/MEMORY.md"), "utf8"),
    ).rejects.toThrow();
    await expect(
      readFile(join(root, "User/memory/.snapshots/run-1/MEMORY.md"), "utf8"),
    ).rejects.toThrow();
    await expect(
      readFile(join(root, ".hydrate_manifest.json"), "utf8").then(JSON.parse),
    ).resolves.toMatchObject({
      files: expect.arrayContaining([
        expect.objectContaining({
          owner: "agent",
          path: "AGENTS.md",
          sourceKey: "tenants/acme/agents/marco/AGENTS.md",
        }),
      ]),
    });
  });

  it("reuses a fresh local workspace cache without redownloading every file", async () => {
    const prefix = "tenants/acme/agents/marco/";
    const store = new FakeStore({
      [`${prefix}AGENTS.md`]: "# Agent",
    });
    const cache = new WorkspaceCache(root, store, {
      now: () => new Date("2026-05-28T12:00:00.000Z"),
    });

    await cache.sync({
      bucket: "workspace-bucket",
      renderedPrefix: prefix,
      partition: PARTITION,
    });
    const cached = await cache.sync({
      bucket: "workspace-bucket",
      renderedPrefix: prefix,
      partition: PARTITION,
    });

    expect(cached).toMatchObject({
      prefix,
      synced: 0,
      deleted: 0,
      total: 1,
      cacheHit: true,
    });
    expect(store.listCalls).toBe(1);
    expect(store.getCalls).toBe(1);
  });

  it("refreshes thread runtime status files instead of serving the local TTL cache", async () => {
    const prefix = "tenants/acme/threads/customer-kickoff/";
    const store = new FakeStore({
      [`${prefix}PROGRESS.md`]: "# Progress v1",
    });
    const cache = new WorkspaceCache(root, store, {
      now: () => new Date("2026-05-28T12:00:00.000Z"),
    });

    const first = await cache.sync({
      bucket: "workspace-bucket",
      renderedPrefix: prefix,
      partition: PARTITION,
    });
    store.setFile(`${prefix}PROGRESS.md`, "# Progress v2");
    const second = await cache.sync({
      bucket: "workspace-bucket",
      renderedPrefix: prefix,
      partition: PARTITION,
    });

    expect(first).toMatchObject({ prefix, synced: 1, total: 1 });
    expect(second).toMatchObject({ prefix, synced: 1, total: 1 });
    expect(second.cacheHit).toBeUndefined();
    expect(store.listCalls).toBe(2);
    expect(store.getCalls).toBe(2);
    await expect(
      readFile(join(second.localDir, "PROGRESS.md"), "utf8"),
    ).resolves.toBe("# Progress v2");
  });

  it("reuses unchanged local files when a new thread prefix remounts the same sources", async () => {
    const firstPrefix = "tenants/acme/threads/customer-kickoff/";
    const secondPrefix = "tenants/acme/threads/customer-followup/";
    const agentKey = "tenants/acme/agents/marco/AGENTS.md";
    const firstManifest = {
      version: 1,
      renderedPrefix: firstPrefix,
      generatedAt: "2026-05-31T18:55:00.000Z",
      sources: [{ owner: "agent", prefix: "tenants/acme/agents/marco/" }],
      files: [
        {
          path: "Agent/AGENTS.md",
          owner: "agent",
          sourceKey: agentKey,
          sourcePrefix: "tenants/acme/agents/marco/",
          sourcePath: "AGENTS.md",
          etag: '"agent"',
          readOnly: false,
        },
      ],
      statusMounts: [],
    };
    const secondManifest = { ...firstManifest, renderedPrefix: secondPrefix };
    const store = new FakeStore({
      [`${firstPrefix}.hydrate_manifest.json`]: `${JSON.stringify(firstManifest)}\n`,
      [`${secondPrefix}.hydrate_manifest.json`]: `${JSON.stringify(secondManifest)}\n`,
      [agentKey]: "# Agent",
    });
    const cache = new WorkspaceCache(root, store, {
      now: () => new Date("2026-05-31T18:55:00.000Z"),
    });

    const first = await cache.sync({
      bucket: "workspace-bucket",
      renderedPrefix: firstPrefix,
      partition: PARTITION,
    });
    const second = await cache.sync({
      bucket: "workspace-bucket",
      renderedPrefix: secondPrefix,
      partition: PARTITION,
    });

    expect(first).toMatchObject({ prefix: firstPrefix, synced: 2, total: 2 });
    expect(second).toMatchObject({
      prefix: secondPrefix,
      synced: 1,
      total: 2,
    });
    expect(second.cacheHit).toBeUndefined();
    expect(store.getCalls).toBe(3);
    await expect(readFile(join(root, "AGENTS.md"), "utf8")).resolves.toBe(
      "# Agent",
    );
    await expect(
      readFile(join(root, "Agent/AGENTS.md"), "utf8"),
    ).rejects.toThrow();
  });

  it("serves stale local files immediately and refreshes unchanged files in the background", async () => {
    const prefix = "tenants/acme/agents/marco/";
    let now = new Date("2026-05-28T12:00:00.000Z");
    const refreshes: Array<() => Promise<void>> = [];
    const store = new FakeStore({
      [`${prefix}AGENTS.md`]: "# Agent",
      [`${prefix}space/SPACE.md`]: "# Space",
    });
    const cache = new WorkspaceCache(root, store, {
      now: () => now,
      backgroundRefresh: (refresh) => refreshes.push(refresh),
    });

    await cache.sync({
      bucket: "workspace-bucket",
      renderedPrefix: prefix,
      partition: PARTITION,
    });
    now = new Date("2026-05-28T12:10:00.000Z");
    const cached = await cache.sync({
      bucket: "workspace-bucket",
      renderedPrefix: prefix,
      partition: PARTITION,
    });

    expect(cached).toMatchObject({
      prefix,
      synced: 0,
      deleted: 0,
      total: 2,
      cacheHit: true,
      cacheStale: true,
    });
    expect(refreshes).toHaveLength(1);
    expect(store.listCalls).toBe(1);
    expect(store.getCalls).toBe(2);

    await refreshes[0]();
    expect(store.listCalls).toBe(2);
    expect(store.getCalls).toBe(2);
  });

  it("redownloads only changed remote objects during background refresh", async () => {
    const prefix = "tenants/acme/agents/marco/";
    let now = new Date("2026-05-28T12:00:00.000Z");
    const refreshes: Array<() => Promise<void>> = [];
    const store = new FakeStore({
      [`${prefix}AGENTS.md`]: "# Agent",
      [`${prefix}space/SPACE.md`]: "# Space",
    });
    const cache = new WorkspaceCache(root, store, {
      now: () => now,
      backgroundRefresh: (refresh) => refreshes.push(refresh),
    });

    await cache.sync({
      bucket: "workspace-bucket",
      renderedPrefix: prefix,
      partition: PARTITION,
    });
    store.setFile(`${prefix}AGENTS.md`, "# Agent v2");
    now = new Date("2026-05-28T12:10:00.000Z");
    const cached = await cache.sync({
      bucket: "workspace-bucket",
      renderedPrefix: prefix,
      partition: PARTITION,
    });

    expect(cached).toMatchObject({
      prefix,
      synced: 0,
      deleted: 0,
      total: 2,
      cacheHit: true,
      cacheStale: true,
    });
    expect(refreshes).toHaveLength(1);
    await refreshes[0]();
    expect(store.getCalls).toBe(3);
    await expect(
      readFile(join(cached.localDir, "AGENTS.md"), "utf8"),
    ).resolves.toBe("# Agent v2");
  });

  it("fails closed when a stale local copy exceeds the offline execution TTL", async () => {
    const prefix = "tenants/acme/agents/marco/";
    let now = new Date("2026-05-28T12:00:00.000Z");
    const store = new FakeStore({
      [`${prefix}AGENTS.md`]: "# Agent",
    });
    const cache = new WorkspaceCache(root, store, {
      now: () => now,
    });

    await cache.sync({
      bucket: "workspace-bucket",
      renderedPrefix: prefix,
      partition: PARTITION,
    });
    store.failList = true;
    now = new Date("2026-05-28T12:16:00.000Z");

    await expect(
      cache.sync({
        bucket: "workspace-bucket",
        renderedPrefix: prefix,
        partition: PARTITION,
      }),
    ).rejects.toBeInstanceOf(WorkspaceAccessRevalidationError);
  });

  it("does not serve a fresh cache hit after the offline execution TTL expires", async () => {
    const prefix = "tenants/acme/agents/marco/";
    let now = new Date("2026-05-28T12:00:00.000Z");
    const store = new FakeStore({
      [`${prefix}AGENTS.md`]: "# Agent",
    });
    const cache = new WorkspaceCache(root, store, {
      cacheTtlMs: 20 * 60 * 1000,
      offlineExecutionTtlMs: 15 * 60 * 1000,
      now: () => now,
    });

    await cache.sync({
      bucket: "workspace-bucket",
      renderedPrefix: prefix,
      partition: PARTITION,
    });
    store.failList = true;
    now = new Date("2026-05-28T12:16:00.000Z");

    await expect(
      cache.sync({
        bucket: "workspace-bucket",
        renderedPrefix: prefix,
        partition: PARTITION,
      }),
    ).rejects.toBeInstanceOf(WorkspaceAccessRevalidationError);
    expect(store.listCalls).toBe(2);
  });

  it("revalidates an expired local copy before serving it again", async () => {
    const prefix = "tenants/acme/agents/marco/";
    let now = new Date("2026-05-28T12:00:00.000Z");
    const store = new FakeStore({
      [`${prefix}AGENTS.md`]: "# Agent",
    });
    const cache = new WorkspaceCache(root, store, {
      now: () => now,
    });

    await cache.sync({
      bucket: "workspace-bucket",
      renderedPrefix: prefix,
      partition: PARTITION,
    });
    now = new Date("2026-05-28T12:16:00.000Z");
    const revalidated = await cache.sync({
      bucket: "workspace-bucket",
      renderedPrefix: prefix,
      partition: PARTITION,
    });

    expect(revalidated).toMatchObject({
      synced: 0,
      accessRevalidated: true,
    });
    expect(store.listCalls).toBe(2);
  });

  it("wipes the flat workspace cache when a Space is revoked", async () => {
    const cache = new WorkspaceCache(root, new FakeStore({}));
    await mkdir(join(root, "Spaces/default"), { recursive: true });
    await writeFile(join(root, "Spaces/default/SPACE.md"), "# Revoked");

    const wiped = await cache.wipeRevokedSpace({
      stage: PARTITION.stage,
      tenantSlug: PARTITION.tenantSlug,
      spaceId: PARTITION.spaceId,
    });

    expect(wiped).toEqual({ deleted: 1 });
    await expect(
      readFile(join(root, "Spaces/default/SPACE.md"), "utf8"),
    ).rejects.toThrow();
  });

  it("rejects workspace prefixes outside the tenant and agent scope", async () => {
    const cache = new WorkspaceCache(root, new FakeStore({}));

    await expect(
      cache.sync({
        bucket: "workspace-bucket",
        renderedPrefix: "tenants/acme/threads/customer-kickoff/",
        partition: PARTITION,
      }),
    ).resolves.toMatchObject({
      prefix: "tenants/acme/threads/customer-kickoff/",
    });

    await expect(
      cache.sync({
        bucket: "workspace-bucket",
        renderedPrefix: "tenants/other/agents/marco/",
        partition: PARTITION,
      }),
    ).rejects.toBeInstanceOf(WorkspaceBoundaryError);

    await expect(
      cache.sync({
        bucket: "workspace-bucket",
        renderedPrefix: "tenants/acme/agents/other/",
        partition: PARTITION,
      }),
    ).rejects.toThrow("outside the expected tenant/agent scope");

    await expect(
      cache.sync({
        bucket: "workspace-bucket",
        renderedPrefix: "tenants/other/threads/customer-kickoff/",
        partition: PARTITION,
      }),
    ).rejects.toThrow("outside the expected tenant/agent scope");

    await expect(
      cache.sync({
        bucket: "workspace-bucket",
        renderedPrefix: "tenants/acme/threads/",
        partition: PARTITION,
      }),
    ).rejects.toThrow("outside the expected tenant/agent scope");

    await expect(
      cache.sync({
        bucket: "workspace-bucket",
        renderedPrefix: "tenants/acme/rendered/marco/sales/user-1/",
        partition: PARTITION,
      }),
    ).rejects.toThrow("outside the expected tenant/agent scope");
  });

  it("rejects unsafe workspace prefixes and object keys", async () => {
    const cache = new WorkspaceCache(
      root,
      new FakeStore({
        "tenants/acme/agents/marco/../secret.txt": "nope",
      }),
    );

    await expect(
      cache.sync({
        bucket: "workspace-bucket",
        renderedPrefix: "/tenants/acme/agents/marco/",
        partition: PARTITION,
      }),
    ).rejects.toThrow("relative S3 prefix");

    await expect(
      cache.sync({
        bucket: "workspace-bucket",
        renderedPrefix: "tenants/acme/agents/marco/",
        partition: PARTITION,
      }),
    ).rejects.toThrow("workspace object key is unsafe");
  });
});

async function rootDirectoryNames(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}
