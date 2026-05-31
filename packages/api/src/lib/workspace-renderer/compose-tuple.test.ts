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
      { content: string; lastModified: Date }
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

describe("renderWorkspaceTuple", () => {
  it("composes agent, user, and Space files into a rendered tuple prefix", async () => {
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
    expect(result.writtenFiles).toContain("AGENTS.md");
    expect(result.writtenFiles).toContain("SPACE.md");
    expect(result.writtenFiles).toContain("space/SPACE.md");
    expect(result.writtenFiles).toContain("space/knowledge/board.md");
    expect(result.writtenFiles).toContain(
      "spaces/board-pack/knowledge/board.md",
    );
    expect(result.writtenFiles).not.toContain("space/TOOLS.md");
    expect(result.writtenFiles).not.toContain("spaces/board-pack/TOOLS.md");
    expect(result.writtenFiles).not.toContain("SPACE_CONTEXT.md");
    expect(result.writtenFiles).not.toContain("effective-policy.json");
    expect(result.writtenFiles).not.toContain("spaces/old/SPACE.md");
    expect(result.effectivePolicy).toMatchObject({
      blockedTools: [],
      mcpAllowedServers: null,
      mcpBlockedServers: [],
    });

    const renderedAgents = store.puts.find((put) =>
      put.key.endsWith("/AGENTS.md"),
    )?.content;
    expect(renderedAgents).toContain("## Active Space");
    expect(renderedAgents).toContain("- **Slug:** board-pack");
    expect(renderedAgents).toContain(
      "- **Active Space folder:** space/SPACE.md",
    );
    expect(renderedAgents).not.toContain("\nold");

    const renderedTools = store.puts.find((put) =>
      put.key.endsWith("/TOOLS.md"),
    )?.content;
    expect(renderedTools).toContain("adds: [browser]");
    expect(renderedTools).not.toContain("warehouse");
    expect(renderedTools).not.toContain("send_email");
  });

  it("returns a cache hit without writes when the marker is newer than source files", async () => {
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
      },
    );

    expect(result.cacheStatus).toBe("hit");
    expect(result.effectivePolicy.blockedTools).toEqual([]);
    expect(result.writtenFiles).toEqual([]);
    expect(store.puts).toEqual([]);
  });

  it("filters rendered workspace mentions from SPACE.md allowlists", async () => {
    const store = new FakeStore(
      seedObjects({
        "tenants/acme/spaces/board-pack/SPACE.md": {
          content: `# Board Pack

## Mentionable Workspaces

\`\`\`
sql
finance analyst
missing-workspace
\`\`\`
`,
          lastModified: "2026-05-22T09:04:00.000Z",
        },
      }),
    );

    await renderWorkspaceTuple(
      { tenantId: "tenant-1", agentId: "agent-1", spaceId: "space-1" },
      {
        bucket: "workspace",
        repository: new FakeRepository(TUPLE),
        objectStore: store,
        now: () => new Date("2026-05-22T10:00:00.000Z"),
      },
    );

    const renderedAgents = store.puts.find((put) =>
      put.key.endsWith("/AGENTS.md"),
    )?.content;
    expect(renderedAgents).toContain("workspaces/sql/");
    expect(renderedAgents).toContain("workspaces/finance-analyst/");
    expect(renderedAgents).not.toContain("workspaces/legal/");
    expect(renderedAgents).not.toContain("missing-workspace");
  });

  it("removes all routing rows when SPACE.md declares an empty mentionable block", async () => {
    const store = new FakeStore(
      seedObjects({
        "tenants/acme/spaces/board-pack/SPACE.md": {
          content: `# Board Pack

## Mentionable Workspaces

\`\`\`
\`\`\`
`,
          lastModified: "2026-05-22T09:04:00.000Z",
        },
      }),
    );

    await renderWorkspaceTuple(
      { tenantId: "tenant-1", agentId: "agent-1", spaceId: "space-1" },
      {
        bucket: "workspace",
        repository: new FakeRepository(TUPLE),
        objectStore: store,
      },
    );

    const renderedAgents = store.puts.find((put) =>
      put.key.endsWith("/AGENTS.md"),
    )?.content;
    expect(renderedAgents).toContain("| Task | Go to | Read | Skills |");
    expect(renderedAgents).not.toContain("workspaces/sql/");
    expect(renderedAgents).not.toContain("workspaces/finance-analyst/");
    expect(renderedAgents).not.toContain("workspaces/legal/");
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

  it("renders agent and user context for an empty default Space", async () => {
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
    expect(result.writtenFiles).toContain("USER.md");
    expect(result.writtenFiles).toContain("SPACE.md");
    expect(result.writtenFiles).not.toContain("space/SPACE.md");

    const renderedUser = store.puts.find((put) =>
      put.key.endsWith("/USER.md"),
    )?.content;
    expect(renderedUser).toBe("# User\n");

    const renderedSpace = store.puts.find((put) =>
      put.key.endsWith("/SPACE.md"),
    )?.content;
    expect(renderedSpace).toContain("# Default");
  });
});
