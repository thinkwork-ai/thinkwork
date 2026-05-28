import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
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

  constructor(private readonly files: Record<string, string>) {}

  async listObjects(input: {
    bucket: string;
    prefix: string;
  }): Promise<Array<{ key: string }>> {
    this.listCalls++;
    expect(input.bucket).toBe("workspace-bucket");
    return Object.keys(this.files)
      .filter((key) => key.startsWith(input.prefix))
      .map((key) => ({ key }));
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

  it("syncs only the approved rendered prefix and removes stale files", async () => {
    const prefix = "tenants/acme/rendered/marco/sales/user-1/";
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
    const prefix = "tenants/acme/rendered/marco/sales/user-1/";
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

  it("rejects rendered prefixes outside the tenant and agent scope", async () => {
    const cache = new WorkspaceCache(root, new FakeStore({}));

    await expect(
      cache.sync({
        bucket: "workspace-bucket",
        renderedPrefix: "tenants/other/rendered/marco/sales/user-1/",
        partition: PARTITION,
      }),
    ).rejects.toBeInstanceOf(WorkspaceBoundaryError);

    await expect(
      cache.sync({
        bucket: "workspace-bucket",
        renderedPrefix: "tenants/acme/rendered/other/sales/user-1/",
        partition: PARTITION,
      }),
    ).rejects.toThrow("outside the expected tenant/agent scope");
  });

  it("rejects unsafe workspace prefixes and object keys", async () => {
    const cache = new WorkspaceCache(
      root,
      new FakeStore({
        "tenants/acme/rendered/marco/sales/user-1/../secret.txt": "nope",
      }),
    );

    await expect(
      cache.sync({
        bucket: "workspace-bucket",
        renderedPrefix: "/tenants/acme/rendered/marco/sales/user-1/",
        partition: PARTITION,
      }),
    ).rejects.toThrow("relative S3 prefix");

    await expect(
      cache.sync({
        bucket: "workspace-bucket",
        renderedPrefix: "tenants/acme/rendered/marco/sales/user-1/",
        partition: PARTITION,
      }),
    ).rejects.toThrow("workspace object key is unsafe");
  });
});
