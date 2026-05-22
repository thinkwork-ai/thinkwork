import { describe, expect, it } from "vitest";
import { renderWorkspaceTuple } from "./compose-tuple.js";
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
  spacePrompt: "Prepare board reporting work.",
  userId: "user-1",
  userSlug: "eric",
  userName: "Eric",
};

class FakeRepository implements WorkspaceTupleRepository {
  constructor(private readonly tuple: ResolvedWorkspaceRenderTuple | null) {}

  async resolve(): Promise<ResolvedWorkspaceRenderTuple | null> {
    return this.tuple;
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
    "tenants/acme/agents/finance-agent/workspace/AGENTS.md": {
      content:
        "# AGENTS.md\n\nRoot routing.\n\n<!-- RENDERED:ACTIVE_SPACE -->\n\nold",
      lastModified: "2026-05-22T09:00:00.000Z",
    },
    "tenants/acme/agents/finance-agent/workspace/TOOLS.md": {
      content: "---\nadds: [browser]\n---\n# Tools\n",
      lastModified: "2026-05-22T09:01:00.000Z",
    },
    "tenants/acme/agents/finance-agent/workspace/IDENTITY.md": {
      content: "# Identity\n",
      lastModified: "2026-05-22T09:02:00.000Z",
    },
    "tenants/acme/agents/finance-agent/workspace/SPACE_CONTEXT.md": {
      content: "# Stale context\n",
      lastModified: "2026-05-22T09:07:00.000Z",
    },
    "tenants/acme/agents/finance-agent/workspace/effective-policy.json": {
      content: "{}\n",
      lastModified: "2026-05-22T09:07:00.000Z",
    },
    "tenants/acme/agents/finance-agent/workspace/space/SPACE.md": {
      content: "# Old Space\n",
      lastModified: "2026-05-22T09:07:00.000Z",
    },
    "tenants/acme/agents/finance-agent/workspace/spaces/old/SPACE.md": {
      content: "# Old Space\n",
      lastModified: "2026-05-22T09:07:00.000Z",
    },
    "tenants/tenant-1/users/user-1/USER.md": {
      content: "# User\n",
      lastModified: "2026-05-22T09:03:00.000Z",
    },
    "tenants/acme/spaces/board-pack/source/SPACE.md": {
      content: "# Board Pack\n",
      lastModified: "2026-05-22T09:04:00.000Z",
    },
    "tenants/acme/spaces/board-pack/source/TOOLS.md": {
      content:
        "---\nadds: [warehouse]\nrestricts:\n  - send_email\n---\n# Space Tools\n",
      lastModified: "2026-05-22T09:05:00.000Z",
    },
    "tenants/acme/spaces/board-pack/source/reports/board.md": {
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
    expect(result.renderedPrefix).toBe(
      "tenants/acme/rendered/finance-agent/board-pack/eric/",
    );
    expect(result.writtenFiles).toContain("AGENTS.md");
    expect(result.writtenFiles).toContain("SPACE.md");
    expect(result.writtenFiles).toContain("space/SPACE.md");
    expect(result.writtenFiles).toContain("space/reports/board.md");
    expect(result.writtenFiles).toContain("spaces/board-pack/reports/board.md");
    expect(result.writtenFiles).not.toContain("SPACE_CONTEXT.md");
    expect(result.writtenFiles).not.toContain("effective-policy.json");
    expect(result.writtenFiles).not.toContain("spaces/old/SPACE.md");

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
    expect(renderedTools).toContain("- browser");
    expect(renderedTools).toContain("- warehouse");
    expect(renderedTools).toContain("- send_email");
  });

  it("returns a cache hit without writes when the marker is newer than source files", async () => {
    const store = new FakeStore(
      seedObjects({
        "tenants/acme/rendered/finance-agent/board-pack/eric/.rendered_at": {
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
    expect(result.writtenFiles).toEqual([]);
    expect(store.puts).toEqual([]);
  });

  it("fails clearly when the Space source prefix has no renderable files", async () => {
    const store = new FakeStore(seedObjects());
    store.deletePrefix("tenants/acme/spaces/board-pack/source/");

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
});
