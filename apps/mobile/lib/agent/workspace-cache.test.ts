import { describe, expect, it } from "vitest";
import {
  MemoryWorkspaceCacheStorage,
  WorkspaceAccessRevalidationError,
  WorkspaceBoundaryError,
  WorkspaceCache,
  assertSafeRelativePath,
  createWorkspaceCachePartition,
  workspaceTargetsForContext,
  type WorkspaceCacheSource,
} from "./workspace-cache";
import type { WorkspaceTarget } from "@/lib/workspace-api";

const PARTITION = createWorkspaceCachePartition({
  stage: "dev",
  tenantId: "tenant-1",
  agentId: "agent-1",
  spaceId: "space-1",
  userId: "user-1",
});

class FakeSource implements WorkspaceCacheSource {
  calls = 0;
  fail = false;

  constructor(
    private readonly filesByTarget: Record<string, Record<string, string>>,
  ) {}

  setFile(targetKey: string, path: string, content: string): void {
    this.filesByTarget[targetKey] ??= {};
    this.filesByTarget[targetKey][path] = content;
  }

  async listFiles(target: WorkspaceTarget): Promise<{
    files: Array<{
      path: string;
      source: "agent" | "space" | "user";
      sha256: string;
      overridden: boolean;
      content: string;
    }>;
  }> {
    this.calls++;
    if (this.fail) throw new Error("offline");
    const key = targetKey(target);
    const files = this.filesByTarget[key] ?? {};
    return {
      files: Object.entries(files).map(([path, content]) => ({
        path,
        source: key.split(":")[0] as "agent" | "space" | "user",
        sha256: `${path}:${content}`,
        overridden: false,
        content,
      })),
    };
  }
}

function targetKey(target: WorkspaceTarget): string {
  if ("agentId" in target) return `agent:${target.agentId}`;
  if ("spaceId" in target) return `space:${target.spaceId}`;
  if ("userId" in target) return `user:${target.userId}`;
  return "other";
}

describe("WorkspaceCache", () => {
  it("syncs workspace targets into a durable partition and serves fresh cache hits", async () => {
    const source = new FakeSource({
      "agent:agent-1": { "AGENTS.md": "# Agent" },
      "space:space-1": { "SPACE.md": "# Space" },
      "user:user-1": { "USER.md": "The human's name is Eric." },
    });
    const cache = new WorkspaceCache(
      new MemoryWorkspaceCacheStorage(),
      source,
      { now: () => new Date("2026-05-30T12:00:00.000Z") },
    );

    const synced = await cache.sync({
      partition: PARTITION,
      targets: [
        { agentId: "agent-1" },
        { spaceId: "space-1" },
        { userId: "user-1" },
      ],
    });
    const cached = await cache.sync({
      partition: PARTITION,
      targets: [
        { agentId: "agent-1" },
        { spaceId: "space-1" },
        { userId: "user-1" },
      ],
    });

    expect(synced).toMatchObject({ synced: 3, deleted: 0, total: 3 });
    expect(cached).toMatchObject({ synced: 0, cacheHit: true, total: 3 });
    expect(source.calls).toBe(3);
    await expect(cache.readFile(PARTITION, "USER.md")).resolves.toMatchObject({
      content: "The human's name is Eric.",
    });
  });

  it("returns stale cache immediately and schedules a background refresh", async () => {
    let now = new Date("2026-05-30T12:00:00.000Z");
    const refreshes: Array<() => Promise<void>> = [];
    const source = new FakeSource({
      "user:user-1": { "USER.md": "v1" },
    });
    const cache = new WorkspaceCache(
      new MemoryWorkspaceCacheStorage(),
      source,
      {
        now: () => now,
        backgroundRefresh: (refresh) => refreshes.push(refresh),
      },
    );

    await cache.sync({ partition: PARTITION, targets: [{ userId: "user-1" }] });
    source.setFile("user:user-1", "USER.md", "v2");
    now = new Date("2026-05-30T12:10:00.000Z");
    const stale = await cache.sync({
      partition: PARTITION,
      targets: [{ userId: "user-1" }],
    });

    expect(stale).toMatchObject({ cacheHit: true, cacheStale: true });
    expect(refreshes).toHaveLength(1);
    await expect(cache.readFile(PARTITION, "USER.md")).resolves.toMatchObject({
      content: "v1",
    });

    await refreshes[0]();
    await expect(cache.readFile(PARTITION, "USER.md")).resolves.toMatchObject({
      content: "v2",
    });
  });

  it("fails closed when cached access is older than the offline execution TTL", async () => {
    let now = new Date("2026-05-30T12:00:00.000Z");
    const source = new FakeSource({
      "space:space-1": { "SPACE.md": "v1" },
    });
    const cache = new WorkspaceCache(
      new MemoryWorkspaceCacheStorage(),
      source,
      { now: () => now },
    );

    await cache.sync({
      partition: PARTITION,
      targets: [{ spaceId: "space-1" }],
    });
    source.fail = true;
    now = new Date("2026-05-30T12:16:00.000Z");

    await expect(
      cache.sync({
        partition: PARTITION,
        targets: [{ spaceId: "space-1" }],
      }),
    ).rejects.toBeInstanceOf(WorkspaceAccessRevalidationError);
  });

  it("does not serve a fresh cache hit after the offline execution TTL expires", async () => {
    let now = new Date("2026-05-30T12:00:00.000Z");
    const source = new FakeSource({
      "space:space-1": { "SPACE.md": "v1" },
    });
    const cache = new WorkspaceCache(
      new MemoryWorkspaceCacheStorage(),
      source,
      {
        cacheTtlMs: 20 * 60 * 1000,
        offlineExecutionTtlMs: 15 * 60 * 1000,
        now: () => now,
      },
    );

    await cache.sync({
      partition: PARTITION,
      targets: [{ spaceId: "space-1" }],
    });
    source.fail = true;
    now = new Date("2026-05-30T12:16:00.000Z");

    await expect(
      cache.sync({
        partition: PARTITION,
        targets: [{ spaceId: "space-1" }],
      }),
    ).rejects.toBeInstanceOf(WorkspaceAccessRevalidationError);
    expect(source.calls).toBe(2);
  });

  it("revalidates expired cached access before serving a Space", async () => {
    let now = new Date("2026-05-30T12:00:00.000Z");
    const source = new FakeSource({
      "space:space-1": { "SPACE.md": "v1" },
    });
    const cache = new WorkspaceCache(
      new MemoryWorkspaceCacheStorage(),
      source,
      { now: () => now },
    );

    await cache.sync({
      partition: PARTITION,
      targets: [{ spaceId: "space-1" }],
    });
    now = new Date("2026-05-30T12:16:00.000Z");
    const revalidated = await cache.sync({
      partition: PARTITION,
      targets: [{ spaceId: "space-1" }],
    });

    expect(revalidated).toMatchObject({
      synced: 0,
      accessRevalidated: true,
    });
    expect(source.calls).toBe(2);
  });

  it("wipes only cache partitions for the revoked Space", async () => {
    const storage = new MemoryWorkspaceCacheStorage();
    const source = new FakeSource({
      "space:space-1": { "SPACE.md": "revoked" },
      "space:space-2": { "SPACE.md": "still granted" },
    });
    const cache = new WorkspaceCache(storage, source, {
      now: () => new Date("2026-05-30T12:00:00.000Z"),
    });
    const otherPartition = createWorkspaceCachePartition({
      ...PARTITION,
      spaceId: "space-2",
    });

    await cache.sync({
      partition: PARTITION,
      targets: [{ spaceId: "space-1" }],
    });
    await cache.sync({
      partition: otherPartition,
      targets: [{ spaceId: "space-2" }],
    });

    const wiped = await cache.wipeRevokedSpace({
      stage: "dev",
      tenantId: "tenant-1",
      spaceId: "space-1",
    });

    expect(wiped).toEqual({ deleted: 1 });
    await expect(cache.readFile(PARTITION, "SPACE.md")).resolves.toBeNull();
    await expect(
      cache.readFile(otherPartition, "SPACE.md"),
    ).resolves.toMatchObject({
      content: "still granted",
    });
  });

  it("resolves mobile cache hydration from typed targets, not S3 prefixes", () => {
    expect(
      workspaceTargetsForContext({
        agentId: " agent-1 ",
        spaceId: "space-1",
        userId: "user-1",
      }),
    ).toEqual([
      { agentId: "agent-1" },
      { spaceId: "space-1" },
      { userId: "user-1" },
    ]);

    expect(
      workspaceTargetsForContext({
        agentId: "",
        spaceId: null,
        userId: " ",
        renderedWorkspacePrefix:
          "tenants/tenant-1/rendered/agent-1/space-1/user-1/",
      } as unknown as Parameters<typeof workspaceTargetsForContext>[0]),
    ).toEqual([]);
  });

  it("rejects unsafe relative paths", () => {
    expect(() => assertSafeRelativePath("../USER.md")).toThrow(
      WorkspaceBoundaryError,
    );
    expect(() => assertSafeRelativePath("/USER.md")).toThrow(
      "workspace path must be relative",
    );
    expect(() => assertSafeRelativePath("nested\\USER.md")).toThrow(
      "workspace path must be relative",
    );
  });
});
