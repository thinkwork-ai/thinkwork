import { describe, expect, it } from "vitest";
import { renderWorkspaceTuple } from "./compose-tuple.js";
import type { SpaceMembershipRepository } from "./space-membership-check.js";
import type {
  ResolvedWorkspaceRenderTuple,
  WorkspaceObjectMetadata,
  WorkspaceRendererObjectStore,
  WorkspaceTupleRepository,
} from "./types.js";

const TUPLE: ResolvedWorkspaceRenderTuple = {
  tenantId: "tenant-1",
  tenantSlug: "acme",
  agentId: "agent-1",
  agentSlug: "finance-agent",
  agentName: "Finance Agent",
  spaceId: "space-1",
  spaceSlug: "board-pack",
  spaceName: "Board Pack",
  spaceKind: "custom",
  spaceAccessMode: "public",
  spacePrompt: "Prepare board reporting work.",
  spaceToolPolicy: { blockedTools: ["send_email"] },
  spaceMcpPolicy: { allowedServers: ["github"], blockedServers: ["prod-db"] },
  threadId: "thread-1",
  threadSlug: "thread-1",
  userId: "user-1",
  userSlug: "eric",
  userName: "Eric",
};

const DEFAULT_SPACE_TUPLE: ResolvedWorkspaceRenderTuple = {
  ...TUPLE,
  spaceId: "default-space",
  spaceSlug: "default",
  spaceName: "Default",
  spaceKind: "default",
  spacePrompt: null,
  spaceToolPolicy: {},
  spaceMcpPolicy: {},
};

class FakeRepository implements WorkspaceTupleRepository {
  constructor(private readonly tuple: ResolvedWorkspaceRenderTuple | null) {}

  async resolve(): Promise<ResolvedWorkspaceRenderTuple | null> {
    return this.tuple;
  }
}

class FakeMembershipRepository implements SpaceMembershipRepository {
  constructor(private readonly memberUserIds: string[] = []) {}

  async isSpaceMember(input: { userId: string }): Promise<boolean> {
    return this.memberUserIds.includes(input.userId);
  }
}

class FakeStore implements WorkspaceRendererObjectStore {
  readonly puts: { key: string; content: string }[] = [];

  constructor(
    private readonly objects: Map<
      string,
      { content: string; lastModified: Date; etag?: string; size?: number }
    >,
  ) {}

  async listObjects(input: {
    prefix: string;
  }): Promise<WorkspaceObjectMetadata[]> {
    return Array.from(this.objects.entries())
      .filter(([key]) => key.startsWith(input.prefix))
      .map(([key, value]) => ({
        key,
        lastModified: value.lastModified,
        etag: value.etag ?? `"${key}"`,
        size: value.size ?? value.content.length,
      }));
  }

  async getText(input: { key: string }): Promise<string | null> {
    return this.objects.get(input.key)?.content ?? null;
  }

  async putText(input: { key: string; content: string }): Promise<void> {
    this.puts.push({ key: input.key, content: input.content });
    this.objects.set(input.key, {
      content: input.content,
      lastModified: new Date("2026-05-22T12:00:00.000Z"),
    });
  }

  deletePrefix(prefix: string): void {
    for (const key of Array.from(this.objects.keys())) {
      if (key.startsWith(prefix)) this.objects.delete(key);
    }
  }

  setObject(
    key: string,
    value: { content: string; lastModified: string; etag?: string },
  ): void {
    this.objects.set(key, {
      content: value.content,
      lastModified: new Date(value.lastModified),
      etag: value.etag,
      size: value.content.length,
    });
  }
}

function seedObjects(
  overrides: Record<string, { content: string; lastModified?: string }> = {},
): Map<string, { content: string; lastModified: Date }> {
  const base: Record<string, { content: string; lastModified?: string }> = {
    "tenants/acme/agents/finance-agent/AGENTS.md": {
      content: `# AGENTS.md

Root routing.

## Folder Structure

\`\`\`text
finance-agent/
├── workspaces/
│   ├── sql/
│   ├── finance-analyst/
│   └── legal/
└── memory/
\`\`\`

## Routing

| Task | Go to | Read | Skills |
| ---- | ----- | ---- | ------ |
| Query warehouse | workspaces/sql/ | CONTEXT.md | snowflake |
| Build board pack | workspaces/finance-analyst/ | CONTEXT.md | sheets |
| Legal review | workspaces/legal/ | CONTEXT.md | contracts |

<!-- RENDERED:ACTIVE_SPACE -->

old`,
      lastModified: "2026-05-22T09:00:00.000Z",
    },
    "tenants/acme/agents/finance-agent/TOOLS.md": {
      content: "---\nadds: [browser]\n---\n# Tools\n",
      lastModified: "2026-05-22T09:01:00.000Z",
    },
    "tenants/acme/agents/finance-agent/IDENTITY.md": {
      content: "# Identity\n",
      lastModified: "2026-05-22T09:02:00.000Z",
    },
    "tenants/acme/agents/finance-agent/SPACE_CONTEXT.md": {
      content: "# Stale context\n",
      lastModified: "2026-05-22T09:07:00.000Z",
    },
    "tenants/acme/agents/finance-agent/effective-policy.json": {
      content: "{}\n",
      lastModified: "2026-05-22T09:07:00.000Z",
    },
    "tenants/acme/agents/finance-agent/space/SPACE.md": {
      content: "# Old Space\n",
      lastModified: "2026-05-22T09:07:00.000Z",
    },
    "tenants/acme/agents/finance-agent/spaces/old/SPACE.md": {
      content: "# Old Space\n",
      lastModified: "2026-05-22T09:07:00.000Z",
    },
    "tenants/acme/users/eric/USER.md": {
      content: "# User\n",
      lastModified: "2026-05-22T09:03:00.000Z",
    },
    "tenants/acme/spaces/board-pack/SPACE.md": {
      content: "# Board Pack\n",
      lastModified: "2026-05-22T09:04:00.000Z",
    },
    "tenants/acme/spaces/board-pack/TOOLS.md": {
      content:
        "---\nadds: [warehouse]\nrestricts:\n  - send_email\n---\n# Space Tools\n",
      lastModified: "2026-05-22T09:05:00.000Z",
    },
    "tenants/acme/spaces/board-pack/knowledge/board.md": {
      content: "# Report\n",
      lastModified: "2026-05-22T09:06:00.000Z",
    },
  };
  return new Map(
    Object.entries({ ...base, ...overrides }).map(([key, value]) => [
      key,
      {
        content: value.content,
        lastModified: new Date(
          value.lastModified ?? "2026-05-22T09:00:00.000Z",
        ),
      },
    ]),
  );
}

function compatibleHydrateManifest(
  overrides: Record<string, unknown> = {},
): string {
  return `${JSON.stringify(
    {
      version: 1,
      renderedPrefix: "tenants/acme/threads/thread-1/",
      generatedAt: "2026-05-22T11:00:00.000Z",
      sources: [
        { owner: "agent", prefix: "tenants/acme/agents/finance-agent/" },
        { owner: "space", prefix: "tenants/acme/spaces/board-pack/" },
        { owner: "user", prefix: "tenants/acme/users/eric/" },
        { owner: "thread_goal", prefix: "tenants/acme/threads/thread-1/" },
      ],
      files: [],
      statusMounts: [
        {
          path: "GOAL.md",
          owner: "system",
          source: "database",
          provider: "thread-goals",
          readOnly: true,
          available: false,
        },
        {
          path: "PROGRESS.md",
          owner: "system",
          source: "database",
          provider: "thread-goals",
          readOnly: true,
          available: false,
        },
      ],
      ...overrides,
    },
    null,
    2,
  )}\n`;
}

describe("renderWorkspaceTuple", () => {
  it("composes agent, user, and Space files by reference into a hydrate manifest", async () => {
    const store = new FakeStore(seedObjects());

    const result = await renderWorkspaceTuple(
      { tenantId: "tenant-1", agentId: "agent-1", spaceId: "space-1" },
      {
        bucket: "workspace",
        repository: new FakeRepository(TUPLE),
        objectStore: store,
        now: () => new Date("2026-05-22T10:00:00.000Z"),
      },
    );

    expect(result.cacheStatus).toBe("miss");
    expect(result.renderedPrefix).toBe("tenants/acme/threads/thread-1/");
    expect(result.sourcePrefixes).toEqual([
      "tenants/acme/agents/finance-agent/",
      "tenants/acme/spaces/board-pack/",
      "tenants/acme/users/eric/",
      "tenants/acme/threads/thread-1/",
    ]);
    expect(result.writtenFiles).toEqual([".hydrate_manifest.json"]);
    expect(result.hydrateManifest.sources).toEqual([
      { owner: "agent", prefix: "tenants/acme/agents/finance-agent/" },
      { owner: "space", prefix: "tenants/acme/spaces/board-pack/" },
      { owner: "user", prefix: "tenants/acme/users/eric/" },
      { owner: "thread_goal", prefix: "tenants/acme/threads/thread-1/" },
    ]);
    expect(result.hydrateManifest.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          owner: "agent",
          path: "AGENTS.md",
          sourceKey: "tenants/acme/agents/finance-agent/AGENTS.md",
        }),
        expect.objectContaining({
          owner: "agent",
          path: "TOOLS.md",
          sourceKey: "tenants/acme/agents/finance-agent/TOOLS.md",
        }),
        expect.objectContaining({
          owner: "space",
          path: "SPACE.md",
          sourceKey: "tenants/acme/spaces/board-pack/SPACE.md",
        }),
        expect.objectContaining({
          owner: "space",
          path: "knowledge/board.md",
          sourceKey: "tenants/acme/spaces/board-pack/knowledge/board.md",
        }),
        expect.objectContaining({
          owner: "user",
          path: "USER.md",
          sourceKey: "tenants/acme/users/eric/USER.md",
        }),
      ]),
    );
    expect(result.hydrateManifest.files).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "SPACE_CONTEXT.md" }),
        expect.objectContaining({ path: "effective-policy.json" }),
        expect.objectContaining({ path: "space/SPACE.md" }),
        expect.objectContaining({ path: "spaces/old/SPACE.md" }),
      ]),
    );
    expect(result.hydrateManifest.statusMounts).toEqual([
      expect.objectContaining({
        path: "GOAL.md",
        source: "database",
        readOnly: true,
        available: false,
      }),
      expect.objectContaining({
        path: "PROGRESS.md",
        source: "database",
        readOnly: true,
        available: false,
      }),
    ]);
    expect(result.effectivePolicy).toMatchObject({
      blockedTools: [],
      mcpAllowedServers: null,
      mcpBlockedServers: [],
    });

    expect(store.puts.map((put) => put.key).sort()).toEqual([
      "tenants/acme/threads/thread-1/.hydrate_manifest.json",
      "tenants/acme/threads/thread-1/.rendered_at",
    ]);
    const manifestPut = store.puts.find((put) =>
      put.key.endsWith(".hydrate_manifest.json"),
    );
    expect(JSON.parse(manifestPut?.content ?? "{}")).toMatchObject({
      renderedPrefix: "tenants/acme/threads/thread-1/",
      files: expect.arrayContaining([
        expect.objectContaining({
          path: "knowledge/board.md",
          sourceKey: "tenants/acme/spaces/board-pack/knowledge/board.md",
        }),
      ]),
    });
  });

  it("mounts rendered status files read-only while exposing narrative goal files as writable", async () => {
    const store = new FakeStore(seedObjects());
    store.setObject("tenants/acme/threads/customer-kickoff/GOAL.md", {
      content: "# Goal\n",
      lastModified: "2026-05-22T09:08:00.000Z",
      etag: '"goal-db"',
    });
    store.setObject("tenants/acme/threads/customer-kickoff/PROGRESS.md", {
      content: "# Progress\n",
      lastModified: "2026-05-22T09:09:00.000Z",
      etag: '"progress-db"',
    });
    store.setObject("tenants/acme/threads/customer-kickoff/DECISIONS.md", {
      content: "# Decisions\n",
      lastModified: "2026-05-22T09:10:00.000Z",
      etag: '"decisions-file"',
    });

    const result = await renderWorkspaceTuple(
      { tenantId: "tenant-1", agentId: "agent-1", spaceId: "space-1" },
      {
        bucket: "workspace",
        repository: new FakeRepository({
          ...TUPLE,
          threadSlug: "customer-kickoff",
        }),
        objectStore: store,
        now: () => new Date("2026-05-22T10:00:00.000Z"),
      },
    );

    expect(result.renderedPrefix).toBe(
      "tenants/acme/threads/customer-kickoff/",
    );
    expect(result.hydrateManifest.statusMounts).toEqual([
      expect.objectContaining({
        path: "GOAL.md",
        available: true,
        sourceKey: "tenants/acme/threads/customer-kickoff/GOAL.md",
        etag: '"goal-db"',
        readOnly: true,
      }),
      expect.objectContaining({
        path: "PROGRESS.md",
        available: true,
        sourceKey: "tenants/acme/threads/customer-kickoff/PROGRESS.md",
        etag: '"progress-db"',
        readOnly: true,
      }),
    ]);
    expect(result.hydrateManifest.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "DECISIONS.md",
          owner: "thread_goal",
          sourceKey: "tenants/acme/threads/customer-kickoff/DECISIONS.md",
          etag: '"decisions-file"',
        }),
      ]),
    );
    expect(result.hydrateManifest.files).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "GOAL.md" }),
        expect.objectContaining({ path: "PROGRESS.md" }),
      ]),
    );
  });

  it("returns a cache hit without writes when the marker is newer than source files", async () => {
    const store = new FakeStore(
      seedObjects({
        "tenants/acme/threads/thread-1/.rendered_at": {
          content: "2026-05-22T11:00:00.000Z",
          lastModified: "2026-05-22T11:00:00.000Z",
        },
        "tenants/acme/threads/thread-1/.hydrate_manifest.json": {
          content: compatibleHydrateManifest(),
          lastModified: "2026-05-22T11:00:00.000Z",
        },
      }),
    );

    const result = await renderWorkspaceTuple(
      { tenantId: "tenant-1", agentId: "agent-1", spaceId: "space-1" },
      {
        bucket: "workspace",
        repository: new FakeRepository(TUPLE),
        objectStore: store,
      },
    );

    expect(result.cacheStatus).toBe("hit");
    expect(result.effectivePolicy.blockedTools).toEqual([]);
    expect(result.writtenFiles).toEqual([]);
    expect(result.hydrateManifest.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "SPACE.md",
          sourceKey: "tenants/acme/spaces/board-pack/SPACE.md",
        }),
      ]),
    );
    expect(store.puts).toEqual([]);
  });

  it("rewrites a fresh legacy hydrate manifest that lacks status and thread-goal ownership", async () => {
    const store = new FakeStore(
      seedObjects({
        "tenants/acme/threads/thread-1/.rendered_at": {
          content: "2026-05-22T11:00:00.000Z",
          lastModified: "2026-05-22T11:00:00.000Z",
        },
        "tenants/acme/threads/thread-1/.hydrate_manifest.json": {
          content: compatibleHydrateManifest({
            sources: [
              { owner: "agent", prefix: "tenants/acme/agents/finance-agent/" },
              { owner: "space", prefix: "tenants/acme/spaces/board-pack/" },
              { owner: "user", prefix: "tenants/acme/users/eric/" },
            ],
            statusMounts: [],
          }),
          lastModified: "2026-05-22T11:00:00.000Z",
        },
      }),
    );

    const result = await renderWorkspaceTuple(
      { tenantId: "tenant-1", agentId: "agent-1", spaceId: "space-1" },
      {
        bucket: "workspace",
        repository: new FakeRepository(TUPLE),
        objectStore: store,
        now: () => new Date("2026-05-22T11:05:00.000Z"),
      },
    );

    expect(result.cacheStatus).toBe("miss");
    expect(result.writtenFiles).toEqual([".hydrate_manifest.json"]);
    const manifestPut = store.puts.find((put) =>
      put.key.endsWith(".hydrate_manifest.json"),
    );
    expect(JSON.parse(manifestPut?.content ?? "{}")).toMatchObject({
      sources: expect.arrayContaining([
        { owner: "thread_goal", prefix: "tenants/acme/threads/thread-1/" },
      ]),
      statusMounts: expect.arrayContaining([
        expect.objectContaining({
          path: "PROGRESS.md",
          source: "database",
          provider: "thread-goals",
          readOnly: true,
        }),
      ]),
    });
  });

  it("rewrites the hydrate manifest when only a legacy marker exists", async () => {
    const store = new FakeStore(
      seedObjects({
        "tenants/acme/threads/thread-1/.rendered_at": {
          content: "2026-05-22T11:00:00.000Z",
          lastModified: "2026-05-22T11:00:00.000Z",
        },
      }),
    );

    const result = await renderWorkspaceTuple(
      { tenantId: "tenant-1", agentId: "agent-1", spaceId: "space-1" },
      {
        bucket: "workspace",
        repository: new FakeRepository(TUPLE),
        objectStore: store,
        now: () => new Date("2026-05-22T11:05:00.000Z"),
      },
    );

    expect(result.cacheStatus).toBe("miss");
    expect(result.writtenFiles).toEqual([".hydrate_manifest.json"]);
    expect(store.puts.map((put) => put.key).sort()).toEqual([
      "tenants/acme/threads/thread-1/.hydrate_manifest.json",
      "tenants/acme/threads/thread-1/.rendered_at",
    ]);
  });

  it("picks up canonical Space source edits without copying files into the thread prefix", async () => {
    const store = new FakeStore(seedObjects());
    await renderWorkspaceTuple(
      { tenantId: "tenant-1", agentId: "agent-1", spaceId: "space-1" },
      {
        bucket: "workspace",
        repository: new FakeRepository(TUPLE),
        objectStore: store,
        now: () => new Date("2026-05-22T10:00:00.000Z"),
      },
    );
    store.puts.length = 0;
    store.setObject("tenants/acme/spaces/board-pack/SPACE.md", {
      content: "# Board Pack v2\n",
      lastModified: "2026-05-22T10:30:00.000Z",
      etag: '"space-v2"',
    });

    const result = await renderWorkspaceTuple(
      { tenantId: "tenant-1", agentId: "agent-1", spaceId: "space-1" },
      {
        bucket: "workspace",
        repository: new FakeRepository(TUPLE),
        objectStore: store,
        now: () => new Date("2026-05-22T10:31:00.000Z"),
      },
    );

    expect(result.cacheStatus).toBe("miss");
    expect(result.hydrateManifest.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "SPACE.md",
          sourceKey: "tenants/acme/spaces/board-pack/SPACE.md",
          etag: '"space-v2"',
          lastModified: "2026-05-22T10:30:00.000Z",
        }),
      ]),
    );
    expect(store.puts.map((put) => put.key).sort()).toEqual([
      "tenants/acme/threads/thread-1/.hydrate_manifest.json",
      "tenants/acme/threads/thread-1/.rendered_at",
    ]);
  });

  it("blocks private Spaces before reading source files for non-members", async () => {
    const store = new FakeStore(seedObjects());

    await expect(
      renderWorkspaceTuple(
        { tenantId: "tenant-1", agentId: "agent-1", spaceId: "space-1" },
        {
          bucket: "workspace",
          repository: new FakeRepository({
            ...TUPLE,
            spaceAccessMode: "private",
            userId: "user-2",
          }),
          objectStore: store,
          spaceMembershipRepository: new FakeMembershipRepository(["user-1"]),
        },
      ),
    ).rejects.toMatchObject({ code: "SpaceAccessDenied" });
    expect(store.puts).toEqual([]);
  });

  it("allows private Spaces for members and service identities", async () => {
    const memberStore = new FakeStore(seedObjects());
    await expect(
      renderWorkspaceTuple(
        { tenantId: "tenant-1", agentId: "agent-1", spaceId: "space-1" },
        {
          bucket: "workspace",
          repository: new FakeRepository({
            ...TUPLE,
            spaceAccessMode: "private",
            userId: "user-1",
          }),
          objectStore: memberStore,
          spaceMembershipRepository: new FakeMembershipRepository(["user-1"]),
        },
      ),
    ).resolves.toMatchObject({ cacheStatus: "miss" });

    const serviceStore = new FakeStore(seedObjects());
    await expect(
      renderWorkspaceTuple(
        {
          tenantId: "tenant-1",
          agentId: "agent-1",
          spaceId: "space-1",
          invokingServiceIdentity: "service-user-1",
        },
        {
          bucket: "workspace",
          repository: new FakeRepository({
            ...TUPLE,
            spaceAccessMode: "private",
            userId: null,
          }),
          objectStore: serviceStore,
          spaceMembershipRepository: new FakeMembershipRepository([
            "service-user-1",
          ]),
        },
      ),
    ).resolves.toMatchObject({ cacheStatus: "miss" });
  });

  it("fails clearly when the Space source prefix has no renderable files", async () => {
    const store = new FakeStore(seedObjects());
    store.deletePrefix("tenants/acme/spaces/board-pack/");

    await expect(
      renderWorkspaceTuple(
        { tenantId: "tenant-1", agentId: "agent-1", spaceId: "space-1" },
        {
          bucket: "workspace",
          repository: new FakeRepository(TUPLE),
          objectStore: store,
        },
      ),
    ).rejects.toMatchObject({ code: "SpaceSourcesNotFound" });
  });

  it("composes agent and user references for a goal-less default Space", async () => {
    const store = new FakeStore(seedObjects());
    store.deletePrefix("tenants/acme/spaces/board-pack/");

    const result = await renderWorkspaceTuple(
      { tenantId: "tenant-1", agentId: "agent-1", spaceId: "default-space" },
      {
        bucket: "workspace",
        repository: new FakeRepository(DEFAULT_SPACE_TUPLE),
        objectStore: store,
        now: () => new Date("2026-05-22T10:00:00.000Z"),
      },
    );

    expect(result.cacheStatus).toBe("miss");
    expect(result.renderedPrefix).toBe("tenants/acme/threads/thread-1/");
    expect(result.writtenFiles).toEqual([".hydrate_manifest.json"]);
    expect(result.hydrateManifest.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ owner: "agent", path: "AGENTS.md" }),
        expect.objectContaining({ owner: "user", path: "USER.md" }),
      ]),
    );
    expect(result.hydrateManifest.files).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "GOAL.md" }),
        expect.objectContaining({ path: "PROGRESS.md" }),
        expect.objectContaining({ path: "SPACE.md", owner: "space" }),
      ]),
    );
    expect(
      result.hydrateManifest.statusMounts.map((mount) => mount.path),
    ).toEqual(["GOAL.md", "PROGRESS.md"]);
  });
});
