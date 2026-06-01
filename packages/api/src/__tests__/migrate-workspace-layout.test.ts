import { describe, expect, it, vi } from "vitest";
import {
  encodeS3CopySourceKey,
  planWorkspaceLayoutTenant,
  runWorkspaceLayoutMigration,
  type FolderAssignment,
  type GoalPrefixAssignment,
  type ListedObject,
  type WorkspaceLayoutObjectStore,
  type WorkspaceLayoutRepository,
  type WorkspaceLayoutTenantSnapshot,
} from "../lib/workspace-layout-migration";

class FakeObjectStore implements WorkspaceLayoutObjectStore {
  copied: Array<{ sourceKey: string; destinationKey: string }> = [];
  deleted: string[] = [];

  constructor(private objects: Map<string, ListedObject>) {}

  static from(entries: Array<[string, Pick<ListedObject, "etag" | "size">]>) {
    return new FakeObjectStore(
      new Map(
        entries.map(([key, metadata]) => [
          key,
          {
            key,
            ...metadata,
          },
        ]),
      ),
    );
  }

  async listObjects(input: {
    bucket: string;
    prefix: string;
  }): Promise<ListedObject[]> {
    expect(input.bucket).toBe("workspace-bucket");
    return Array.from(this.objects.values()).filter((object) =>
      object.key.startsWith(input.prefix),
    );
  }

  async copyObject(input: {
    bucket: string;
    sourceKey: string;
    destinationKey: string;
  }): Promise<void> {
    expect(input.bucket).toBe("workspace-bucket");
    const source = this.objects.get(input.sourceKey);
    if (!source) throw new Error(`missing source ${input.sourceKey}`);
    this.objects.set(input.destinationKey, {
      ...source,
      key: input.destinationKey,
    });
    this.copied.push({
      sourceKey: input.sourceKey,
      destinationKey: input.destinationKey,
    });
  }

  async deleteObjects(input: {
    bucket: string;
    keys: string[];
  }): Promise<void> {
    expect(input.bucket).toBe("workspace-bucket");
    for (const key of input.keys) {
      this.objects.delete(key);
      this.deleted.push(key);
    }
  }
}

class FakeRepository implements WorkspaceLayoutRepository {
  appliedAssignments: FolderAssignment[] = [];
  appliedGoalPrefixes: GoalPrefixAssignment[] = [];

  constructor(private readonly snapshot: WorkspaceLayoutTenantSnapshot) {}

  async snapshots(): Promise<WorkspaceLayoutTenantSnapshot[]> {
    return [this.snapshot];
  }

  async applyFolderAssignments(input: {
    assignments: FolderAssignment[];
    goalPrefixAssignments: GoalPrefixAssignment[];
  }): Promise<void> {
    this.appliedAssignments.push(...input.assignments);
    this.appliedGoalPrefixes.push(...input.goalPrefixAssignments);
  }
}

const SNAPSHOT: WorkspaceLayoutTenantSnapshot = {
  tenant: { id: "tenant-1", slug: "acme" },
  agents: [
    {
      id: "agent-1",
      tenantId: "tenant-1",
      displayName: "Marco",
      fallbackName: "marco",
      workspaceFolderName: null,
    },
  ],
  spaces: [
    {
      id: "space-1",
      tenantId: "tenant-1",
      displayName: "Board Pack",
      fallbackName: "sales",
      workspaceFolderName: null,
    },
  ],
  users: [
    {
      id: "user-1",
      tenantId: "tenant-1",
      displayName: "Eric Odom",
      fallbackName: "eric",
      workspaceFolderName: null,
    },
  ],
  threads: [
    {
      id: "thread-1",
      tenantId: "tenant-1",
      displayName: "Customer Kickoff",
      fallbackName: "thread-1",
      workspaceFolderName: null,
      agentId: "agent-1",
      spaceId: "space-1",
      userId: "user-1",
    },
  ],
  goals: [
    {
      id: "goal-1",
      tenantId: "tenant-1",
      displayName: "Launch account",
      fallbackName: "goal-1",
      workspaceFolderName: null,
      threadId: "thread-1",
      folderS3Prefix: "tenants/acme/threads/thread-1/",
    },
  ],
};

describe("migrate-workspace-layout", () => {
  it("encodes S3 copy source keys without escaping path separators", () => {
    expect(
      encodeS3CopySourceKey("tenants/acme/agents/marco/Plan #1 + notes.md"),
    ).toBe("tenants/acme/agents/marco/Plan%20%231%20%2B%20notes.md");
  });

  it("dry-runs folder backfills, source copies, rendered deletes, and thread renders", async () => {
    const store = FakeObjectStore.from([
      ["tenants/acme/agents/marco/workspace/AGENTS.md", { etag: "a", size: 1 }],
      [
        "tenants/acme/agents/marco/workspace-archives/old/AGENTS.md",
        { etag: "archive", size: 1 },
      ],
      ["tenants/acme/spaces/sales/SPACE.md", { etag: "s", size: 1 }],
      [
        "tenants/acme/spaces/sales/source/artifacts/brief.md",
        { etag: "brief", size: 1 },
      ],
      ["tenants/acme/users/eric/USER.md", { etag: "u", size: 1 }],
      [
        "tenants/tenant-1/users/user-1/memory/preferences.md",
        { etag: "m", size: 1 },
      ],
      ["tenants/acme/threads/thread-1/DECISIONS.md", { etag: "t", size: 1 }],
      [
        "tenants/acme/rendered/marco/sales/eric/AGENTS.md",
        { etag: "r", size: 1 },
      ],
      [
        "tenants/acme/rendered/marco/sales/eric/USER.md",
        { etag: "ru", size: 1 },
      ],
      [
        "tenants/acme/rendered/marco/sales/eric/memory/preferences.md",
        { etag: "rp", size: 1 },
      ],
    ]);

    const plan = await planWorkspaceLayoutTenant({
      bucket: "workspace-bucket",
      snapshot: SNAPSHOT,
      objectStore: store,
      deleteLegacySources: true,
    });

    expect(plan.status).toBe("dry-run");
    expect(plan.folderAssignments.map((assignment) => assignment.next)).toEqual(
      [
        "marco",
        "board-pack",
        "eric-odom",
        "customer-kickoff",
        "launch-account",
      ],
    );
    expect(plan.goalPrefixAssignments).toEqual([
      {
        id: "goal-1",
        previous: "tenants/acme/threads/thread-1/",
        next: "tenants/acme/threads/customer-kickoff/",
      },
    ]);
    expect(plan.plannedCopies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKey: "tenants/acme/agents/marco/workspace/AGENTS.md",
          destinationKey: "tenants/acme/agents/marco/AGENTS.md",
        }),
        expect.objectContaining({
          sourceKey: "tenants/acme/spaces/sales/SPACE.md",
          destinationKey: "tenants/acme/spaces/board-pack/SPACE.md",
        }),
        expect.objectContaining({
          sourceKey: "tenants/acme/spaces/sales/source/artifacts/brief.md",
          destinationKey: "tenants/acme/spaces/board-pack/artifacts/brief.md",
        }),
        expect.objectContaining({
          sourceKey: "tenants/acme/users/eric/USER.md",
          destinationKey: "tenants/acme/users/eric-odom/USER.md",
        }),
        expect.objectContaining({
          sourceKey: "tenants/tenant-1/users/user-1/memory/preferences.md",
          destinationKey: "tenants/acme/users/eric-odom/memory/preferences.md",
        }),
        expect.objectContaining({
          sourceKey: "tenants/acme/threads/thread-1/DECISIONS.md",
          destinationKey: "tenants/acme/threads/customer-kickoff/DECISIONS.md",
        }),
      ]),
    );
    expect(plan.deletePrefixes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          prefix: "tenants/acme/agents/marco/workspace-archives/",
          reason: "legacy-source",
          keys: ["tenants/acme/agents/marco/workspace-archives/old/AGENTS.md"],
        }),
        expect.objectContaining({
          prefix: "tenants/acme/rendered/",
          reason: "retired-rendered",
          keys: expect.arrayContaining([
            "tenants/acme/rendered/marco/sales/eric/AGENTS.md",
          ]),
        }),
      ]),
    );
    expect(plan.plannedRenders).toEqual([
      {
        tenantId: "tenant-1",
        agentId: "agent-1",
        spaceId: "space-1",
        threadId: "thread-1",
        userId: "user-1",
        renderedPrefix: "tenants/acme/threads/customer-kickoff/",
      },
    ]);
  });

  it("reports conflicts instead of overwriting different destination objects", async () => {
    const store = FakeObjectStore.from([
      ["tenants/acme/spaces/sales/SPACE.md", { etag: "old", size: 10 }],
      ["tenants/acme/spaces/board-pack/SPACE.md", { etag: "new", size: 10 }],
    ]);

    const plan = await planWorkspaceLayoutTenant({
      bucket: "workspace-bucket",
      snapshot: SNAPSHOT,
      objectStore: store,
      deleteLegacySources: true,
    });

    expect(plan.status).toBe("conflict");
    expect(plan.conflicts).toContain(
      "tenants/acme/spaces/sales/SPACE.md -> tenants/acme/spaces/board-pack/SPACE.md already exists with different metadata",
    );
  });

  it("prefers canonical user workspace objects over legacy UUID copies", async () => {
    const store = FakeObjectStore.from([
      [
        "tenants/acme/users/eric-odom/memory/DREAMS.md",
        { etag: "new", size: 10 },
      ],
      [
        "tenants/tenant-1/users/user-1/memory/DREAMS.md",
        { etag: "old", size: 10 },
      ],
    ]);

    const plan = await planWorkspaceLayoutTenant({
      bucket: "workspace-bucket",
      snapshot: SNAPSHOT,
      objectStore: store,
      deleteLegacySources: true,
    });

    expect(plan.status).toBe("dry-run");
    expect(plan.conflicts).toEqual([]);
    expect(plan.plannedCopies).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKey: "tenants/tenant-1/users/user-1/memory/DREAMS.md",
        }),
      ]),
    );
    expect(plan.deletePrefixes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          prefix: "tenants/tenant-1/users/user-1/",
          keys: ["tenants/tenant-1/users/user-1/memory/DREAMS.md"],
        }),
      ]),
    );
  });

  it("recovers user files from retired rendered tuple prefixes when user source is empty", async () => {
    const store = FakeObjectStore.from([
      [
        "tenants/acme/rendered/marco/sales/eric/USER.md",
        { etag: "ru", size: 1 },
      ],
      [
        "tenants/acme/rendered/marco/sales/eric/memory/preferences.md",
        { etag: "rp", size: 1 },
      ],
      [
        "tenants/acme/rendered/marco/sales/eric/AGENTS.md",
        { etag: "agent", size: 1 },
      ],
    ]);

    const plan = await planWorkspaceLayoutTenant({
      bucket: "workspace-bucket",
      snapshot: SNAPSHOT,
      objectStore: store,
      deleteLegacySources: true,
    });

    expect(plan.plannedCopies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKey: "tenants/acme/rendered/marco/sales/eric/USER.md",
          destinationKey: "tenants/acme/users/eric-odom/USER.md",
        }),
        expect.objectContaining({
          sourceKey:
            "tenants/acme/rendered/marco/sales/eric/memory/preferences.md",
          destinationKey: "tenants/acme/users/eric-odom/memory/preferences.md",
        }),
      ]),
    );
    expect(plan.plannedCopies).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKey: "tenants/acme/rendered/marco/sales/eric/AGENTS.md",
        }),
      ]),
    );
  });

  it("rejects non-positive apply batch sizes", async () => {
    await expect(
      runWorkspaceLayoutMigration(
        {
          mode: "apply",
          bucket: "workspace-bucket",
          batchSize: 0,
        },
        {
          objectStore: FakeObjectStore.from([]),
          repository: new FakeRepository(SNAPSHOT),
          renderer: {
            render: vi.fn(async () => undefined),
          },
        },
      ),
    ).rejects.toThrow("--batch-size must be a positive integer");
  });

  it("applies copies, DB assignments, renders thread runtimes, and deletes retired prefixes", async () => {
    const store = FakeObjectStore.from([
      ["tenants/acme/agents/marco/workspace/AGENTS.md", { etag: "a", size: 1 }],
      ["tenants/acme/threads/thread-1/DECISIONS.md", { etag: "t", size: 1 }],
      [
        "tenants/acme/rendered/marco/sales/eric/AGENTS.md",
        { etag: "r", size: 1 },
      ],
      [
        "tenants/acme/rendered/marco/sales/eric/USER.md",
        { etag: "ru", size: 1 },
      ],
    ]);
    const repository = new FakeRepository(SNAPSHOT);
    const renderer = {
      render: vi.fn(async () => undefined),
    };

    const result = await runWorkspaceLayoutMigration(
      {
        mode: "apply",
        bucket: "workspace-bucket",
      },
      {
        objectStore: store,
        repository,
        renderer,
      },
    );

    expect(result.summary.errors).toBe(0);
    expect(result.summary.conflicts).toBe(0);
    expect(repository.appliedAssignments).toHaveLength(5);
    expect(repository.appliedGoalPrefixes).toEqual([
      {
        id: "goal-1",
        previous: "tenants/acme/threads/thread-1/",
        next: "tenants/acme/threads/customer-kickoff/",
      },
    ]);
    expect(store.copied).toEqual(
      expect.arrayContaining([
        {
          sourceKey: "tenants/acme/agents/marco/workspace/AGENTS.md",
          destinationKey: "tenants/acme/agents/marco/AGENTS.md",
        },
        {
          sourceKey: "tenants/acme/threads/thread-1/DECISIONS.md",
          destinationKey: "tenants/acme/threads/customer-kickoff/DECISIONS.md",
        },
        {
          sourceKey: "tenants/acme/rendered/marco/sales/eric/USER.md",
          destinationKey: "tenants/acme/users/eric-odom/USER.md",
        },
      ]),
    );
    expect(store.deleted).toContain(
      "tenants/acme/rendered/marco/sales/eric/AGENTS.md",
    );
    expect(renderer.render).toHaveBeenCalledWith({
      bucket: "workspace-bucket",
      tenantId: "tenant-1",
      agentId: "agent-1",
      spaceId: "space-1",
      threadId: "thread-1",
      userId: "user-1",
    });
  });

  it("cleans legacy wrappers under already assigned workspace folders", async () => {
    const snapshot: WorkspaceLayoutTenantSnapshot = {
      ...SNAPSHOT,
      agents: [{ ...SNAPSHOT.agents[0], workspaceFolderName: "marco" }],
      spaces: [{ ...SNAPSHOT.spaces[0], workspaceFolderName: "board-pack" }],
      users: [{ ...SNAPSHOT.users[0], workspaceFolderName: "eric-odom" }],
      threads: [
        {
          ...SNAPSHOT.threads[0],
          workspaceFolderName: "customer-kickoff",
        },
      ],
      goals: [
        {
          ...SNAPSHOT.goals[0],
          workspaceFolderName: "launch-account",
          folderS3Prefix: "tenants/acme/threads/customer-kickoff/",
        },
      ],
    };
    const store = FakeObjectStore.from([
      ["tenants/acme/agents/marco/workspace/AGENTS.md", { etag: "a", size: 1 }],
      [
        "tenants/acme/agents/marco/workspace-archives/old/AGENTS.md",
        { etag: "archive", size: 1 },
      ],
      [
        "tenants/acme/spaces/board-pack/source/CONTEXT.md",
        { etag: "s", size: 1 },
      ],
      [
        "tenants/acme/threads/customer-kickoff/.hydrate_manifest.json",
        { etag: "m", size: 1 },
      ],
    ]);

    const plan = await planWorkspaceLayoutTenant({
      bucket: "workspace-bucket",
      snapshot,
      objectStore: store,
      deleteLegacySources: true,
    });

    expect(plan.status).toBe("dry-run");
    expect(plan.folderAssignments).toEqual([]);
    expect(plan.plannedCopies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKey: "tenants/acme/agents/marco/workspace/AGENTS.md",
          destinationKey: "tenants/acme/agents/marco/AGENTS.md",
        }),
        expect.objectContaining({
          sourceKey: "tenants/acme/spaces/board-pack/source/CONTEXT.md",
          destinationKey: "tenants/acme/spaces/board-pack/CONTEXT.md",
        }),
      ]),
    );
    expect(plan.deletePrefixes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          prefix: "tenants/acme/agents/marco/workspace/",
          keys: ["tenants/acme/agents/marco/workspace/AGENTS.md"],
        }),
        expect.objectContaining({
          prefix: "tenants/acme/agents/marco/workspace-archives/",
          keys: ["tenants/acme/agents/marco/workspace-archives/old/AGENTS.md"],
        }),
        expect.objectContaining({
          prefix: "tenants/acme/spaces/board-pack/",
          keys: ["tenants/acme/spaces/board-pack/source/CONTEXT.md"],
        }),
      ]),
    );
    expect(plan.plannedRenders).toEqual([
      {
        tenantId: "tenant-1",
        agentId: "agent-1",
        spaceId: "space-1",
        threadId: "thread-1",
        userId: "user-1",
        renderedPrefix: "tenants/acme/threads/customer-kickoff/",
      },
    ]);
  });

  it("deletes stale same-folder wrappers when canonical root files already exist", async () => {
    const snapshot: WorkspaceLayoutTenantSnapshot = {
      ...SNAPSHOT,
      agents: [{ ...SNAPSHOT.agents[0], workspaceFolderName: "marco" }],
      spaces: [{ ...SNAPSHOT.spaces[0], workspaceFolderName: "board-pack" }],
      users: [{ ...SNAPSHOT.users[0], workspaceFolderName: "eric-odom" }],
      threads: [
        {
          ...SNAPSHOT.threads[0],
          workspaceFolderName: "customer-kickoff",
        },
      ],
      goals: [
        {
          ...SNAPSHOT.goals[0],
          workspaceFolderName: "launch-account",
          folderS3Prefix: "tenants/acme/threads/customer-kickoff/",
        },
      ],
    };
    const store = FakeObjectStore.from([
      ["tenants/acme/agents/marco/AGENTS.md", { etag: "new", size: 2 }],
      [
        "tenants/acme/agents/marco/workspace/AGENTS.md",
        { etag: "old", size: 1 },
      ],
      ["tenants/acme/spaces/board-pack/CONTEXT.md", { etag: "new", size: 2 }],
      [
        "tenants/acme/spaces/board-pack/source/CONTEXT.md",
        { etag: "old", size: 1 },
      ],
      [
        "tenants/acme/threads/customer-kickoff/.hydrate_manifest.json",
        { etag: "m", size: 1 },
      ],
    ]);

    const plan = await planWorkspaceLayoutTenant({
      bucket: "workspace-bucket",
      snapshot,
      objectStore: store,
      deleteLegacySources: true,
    });

    expect(plan.conflicts).toEqual([]);
    expect(plan.plannedCopies).toEqual([]);
    expect(plan.deletePrefixes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          prefix: "tenants/acme/agents/marco/workspace/",
          keys: ["tenants/acme/agents/marco/workspace/AGENTS.md"],
        }),
        expect.objectContaining({
          prefix: "tenants/acme/spaces/board-pack/",
          keys: ["tenants/acme/spaces/board-pack/source/CONTEXT.md"],
        }),
      ]),
    );
  });

  it("returns noop once folder names, thread manifest, and new layout are present", async () => {
    const snapshot: WorkspaceLayoutTenantSnapshot = {
      ...SNAPSHOT,
      agents: [{ ...SNAPSHOT.agents[0], workspaceFolderName: "marco" }],
      spaces: [{ ...SNAPSHOT.spaces[0], workspaceFolderName: "board-pack" }],
      users: [{ ...SNAPSHOT.users[0], workspaceFolderName: "eric-odom" }],
      threads: [
        {
          ...SNAPSHOT.threads[0],
          workspaceFolderName: "customer-kickoff",
        },
      ],
      goals: [
        {
          ...SNAPSHOT.goals[0],
          workspaceFolderName: "launch-account",
          folderS3Prefix: "tenants/acme/threads/customer-kickoff/",
        },
      ],
    };
    const store = FakeObjectStore.from([
      ["tenants/acme/agents/marco/AGENTS.md", { etag: "a", size: 1 }],
      [
        "tenants/acme/threads/customer-kickoff/.hydrate_manifest.json",
        { etag: "m", size: 1 },
      ],
    ]);

    const plan = await planWorkspaceLayoutTenant({
      bucket: "workspace-bucket",
      snapshot,
      objectStore: store,
      deleteLegacySources: true,
    });

    expect(plan.status).toBe("noop");
    expect(plan.plannedCopies).toEqual([]);
    expect(plan.deletePrefixes).toEqual([]);
    expect(plan.plannedRenders).toEqual([]);
  });
});
