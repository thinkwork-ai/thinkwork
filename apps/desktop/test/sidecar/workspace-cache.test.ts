import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
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

  it("wipes only the revoked Space subtree", async () => {
    const cache = new WorkspaceCache(root, new FakeStore({}));
    const revokedDir = cache.partitionPath(PARTITION);
    const stillGrantedDir = cache.partitionPath({
      ...PARTITION,
      spaceId: "space-2",
    });
    await mkdir(revokedDir, { recursive: true });
    await mkdir(stillGrantedDir, { recursive: true });
    await writeFile(join(revokedDir, "SPACE.md"), "# Revoked");
    await writeFile(join(stillGrantedDir, "SPACE.md"), "# Still granted");

    const wiped = await cache.wipeRevokedSpace({
      stage: PARTITION.stage,
      tenantSlug: PARTITION.tenantSlug,
      spaceId: PARTITION.spaceId,
    });

    expect(wiped).toEqual({ deleted: 1 });
    await expect(
      readFile(join(revokedDir, "SPACE.md"), "utf8"),
    ).rejects.toThrow();
    await expect(
      readFile(join(stillGrantedDir, "SPACE.md"), "utf8"),
    ).resolves.toBe("# Still granted");
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
