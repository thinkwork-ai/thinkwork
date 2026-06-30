import { describe, expect, it } from "vitest";
import { WORKSPACE_ROUTING_MARKER } from "./agents-md-composer.js";
import {
  agentsMdContentSha,
  agentsMdHistoryKey,
  renderWorkspaceTuple,
} from "./compose-tuple.js";
import {
  spaceTriggerServiceIdentity,
  type SpaceMembershipRepository,
} from "./space-membership-check.js";
import type {
  ResolvedWorkspaceRenderTuple,
  WorkspaceAgentProfileRoutingEntry,
  WorkspaceObjectMetadata,
  WorkspaceRendererObjectStore,
  WorkspaceSpaceIndexEntry,
  WorkspaceSpaceParticipantEntry,
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

interface FakeRepositoryOptions {
  authorizedSpaces?: WorkspaceSpaceIndexEntry[];
  participants?: WorkspaceSpaceParticipantEntry[];
  agentProfiles?: WorkspaceAgentProfileRoutingEntry[];
}

class FakeRepository implements WorkspaceTupleRepository {
  constructor(
    private readonly tuple: ResolvedWorkspaceRenderTuple | null,
    private readonly options: FakeRepositoryOptions = {},
  ) {}

  async resolve(): Promise<ResolvedWorkspaceRenderTuple | null> {
    return this.tuple;
  }

  async listAuthorizedSpaces(
    tuple: ResolvedWorkspaceRenderTuple,
  ): Promise<WorkspaceSpaceIndexEntry[]> {
    return (
      this.options.authorizedSpaces ?? [
        {
          id: tuple.spaceId,
          slug: tuple.spaceSlug,
          name: tuple.spaceName,
          accessMode: tuple.spaceAccessMode,
          isActive: true,
        },
      ]
    );
  }

  async listSpaceParticipants(): Promise<WorkspaceSpaceParticipantEntry[]> {
    return this.options.participants ?? [];
  }

  async listRoutableAgentProfiles(): Promise<
    WorkspaceAgentProfileRoutingEntry[]
  > {
    return this.options.agentProfiles ?? [];
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
    "tenants/acme/agents/finance-agent/workspace/LEGACY.md": {
      content: "# Legacy workspace wrapper\n",
      lastModified: "2026-05-22T09:01:30.000Z",
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
    "tenants/acme/users/eric/knowledge-pack.md": {
      content: "# Distilled User Knowledge\n",
      lastModified: "2026-05-22T09:03:10.000Z",
    },
    "tenants/acme/users/eric/TOOLS.md": {
      content: "---\nmodelRouting: []\n---\n# User Tools\n",
      lastModified: "2026-05-22T09:03:15.000Z",
    },
    "tenants/acme/users/eric/memory/preferences.md": {
      content: "# Preferences\n",
      lastModified: "2026-05-22T09:03:20.000Z",
    },
    "tenants/acme/users/eric/memory/.snapshots/run-1/memory.md": {
      content: "# Internal snapshot\n",
      lastModified: "2026-05-22T09:03:30.000Z",
    },
    "tenants/acme/users/eric/memory/working/2026-05-22.md": {
      content: "# Working notes\n",
      lastModified: "2026-05-22T09:03:40.000Z",
    },
    "tenants/acme/users/eric/memory/reports/thread-idle/run-1.md": {
      content: "# Idle report\n",
      lastModified: "2026-05-22T09:03:50.000Z",
    },
    "tenants/acme/spaces/board-pack/TOOLS.md": {
      content:
        "---\nadds: [warehouse]\nrestricts:\n  - send_email\n---\n# Space Tools\n",
      lastModified: "2026-05-22T09:05:00.000Z",
    },
    "tenants/acme/spaces/board-pack/CONTEXT.md": {
      content: "# Space Context\n",
      lastModified: "2026-05-22T09:05:30.000Z",
    },
    "tenants/acme/spaces/board-pack/plans/kickoff.md": {
      content: "# Kickoff\n",
      lastModified: "2026-05-22T09:05:45.000Z",
    },
    "tenants/acme/spaces/board-pack/knowledge/board.md": {
      content: "# Report\n",
      lastModified: "2026-05-22T09:06:00.000Z",
    },
    "tenants/acme/spaces/board-pack/skills/ratio-review/SKILL.md": {
      content: "---\ndisplay_name: Ratio Review\n---\n# Ratio Review\n",
      lastModified: "2026-05-22T09:06:10.000Z",
    },
    "tenants/acme/threads/thread-1/notes/findings.md": {
      content: "# Findings\n",
      lastModified: "2026-05-22T09:06:30.000Z",
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
        { owner: "thread_notes", prefix: "tenants/acme/threads/thread-1/" },
      ],
      files: [
        {
          path: "AGENTS.md",
          owner: "agent",
          sourceKey: "tenants/acme/threads/thread-1/AGENTS.md",
          sourcePrefix: "tenants/acme/threads/thread-1/",
          sourcePath: "AGENTS.md",
          readOnly: true,
          generated: true,
        },
        {
          path: "IDENTITY.md",
          owner: "agent",
          sourceKey: "tenants/acme/agents/finance-agent/IDENTITY.md",
          sourcePrefix: "tenants/acme/agents/finance-agent/",
          sourcePath: "IDENTITY.md",
          readOnly: false,
        },
        {
          path: "LEGACY.md",
          owner: "agent",
          sourceKey: "tenants/acme/agents/finance-agent/workspace/LEGACY.md",
          sourcePrefix: "tenants/acme/agents/finance-agent/",
          sourcePath: "LEGACY.md",
          readOnly: false,
        },
        {
          path: "TOOLS.md",
          owner: "agent",
          sourceKey: "tenants/acme/agents/finance-agent/TOOLS.md",
          sourcePrefix: "tenants/acme/agents/finance-agent/",
          sourcePath: "TOOLS.md",
          readOnly: false,
        },
        {
          path: "Spaces/board-pack/CONTEXT.md",
          owner: "space",
          sourceKey: "tenants/acme/spaces/board-pack/CONTEXT.md",
          sourcePrefix: "tenants/acme/spaces/board-pack/",
          sourcePath: "CONTEXT.md",
          readOnly: false,
        },
        {
          path: "Spaces/board-pack/knowledge/board.md",
          owner: "space",
          sourceKey: "tenants/acme/spaces/board-pack/knowledge/board.md",
          sourcePrefix: "tenants/acme/spaces/board-pack/",
          sourcePath: "knowledge/board.md",
          readOnly: false,
        },
        {
          path: "Spaces/board-pack/plans/kickoff.md",
          owner: "space",
          sourceKey: "tenants/acme/spaces/board-pack/plans/kickoff.md",
          sourcePrefix: "tenants/acme/spaces/board-pack/",
          sourcePath: "plans/kickoff.md",
          readOnly: false,
        },
        {
          path: "User/USER.md",
          owner: "user",
          sourceKey: "tenants/acme/users/eric/USER.md",
          sourcePrefix: "tenants/acme/users/eric/",
          sourcePath: "USER.md",
          readOnly: false,
        },
        {
          path: "User/knowledge-pack.md",
          owner: "user",
          sourceKey: "tenants/acme/users/eric/knowledge-pack.md",
          sourcePrefix: "tenants/acme/users/eric/",
          sourcePath: "knowledge-pack.md",
          readOnly: false,
        },
        {
          path: "User/memory/preferences.md",
          owner: "user",
          sourceKey: "tenants/acme/users/eric/memory/preferences.md",
          sourcePrefix: "tenants/acme/users/eric/",
          sourcePath: "memory/preferences.md",
          readOnly: false,
        },
        {
          path: "Thread/notes/findings.md",
          owner: "thread_notes",
          sourceKey: "tenants/acme/threads/thread-1/notes/findings.md",
          sourcePrefix: "tenants/acme/threads/thread-1/",
          sourcePath: "notes/findings.md",
          readOnly: false,
        },
      ],
      statusMounts: [
        {
          path: "Thread/THREAD.md",
          owner: "system",
          source: "database",
          provider: "thread-goals",
          readOnly: true,
          available: false,
        },
        {
          path: "Thread/GOAL.md",
          owner: "system",
          source: "database",
          provider: "thread-goals",
          readOnly: true,
          available: false,
        },
        {
          path: "Thread/PROGRESS.md",
          owner: "system",
          source: "database",
          provider: "thread-goals",
          readOnly: true,
          available: false,
        },
        {
          path: "Thread/TASKS.md",
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
    expect(result.writtenFiles).toEqual([
      "AGENTS.md",
      ".hydrate_manifest.json",
    ]);
    expect(result.hydrateManifest.sources).toEqual([
      { owner: "agent", prefix: "tenants/acme/agents/finance-agent/" },
      { owner: "space", prefix: "tenants/acme/spaces/board-pack/" },
      { owner: "user", prefix: "tenants/acme/users/eric/" },
      { owner: "thread_goal", prefix: "tenants/acme/threads/thread-1/" },
      { owner: "thread_notes", prefix: "tenants/acme/threads/thread-1/" },
    ]);
    expect(result.hydrateManifest.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          owner: "agent",
          path: "AGENTS.md",
          sourceKey: "tenants/acme/threads/thread-1/AGENTS.md",
          readOnly: true,
          generated: true,
        }),
        expect.objectContaining({
          owner: "agent",
          path: "TOOLS.md",
          sourceKey: "tenants/acme/agents/finance-agent/TOOLS.md",
        }),
        expect.objectContaining({
          owner: "agent",
          path: "LEGACY.md",
          sourceKey: "tenants/acme/agents/finance-agent/workspace/LEGACY.md",
          sourcePath: "LEGACY.md",
        }),
        expect.objectContaining({
          owner: "space",
          path: "Spaces/board-pack/CONTEXT.md",
          sourceKey: "tenants/acme/spaces/board-pack/CONTEXT.md",
        }),
        expect.objectContaining({
          owner: "space",
          path: "Spaces/board-pack/plans/kickoff.md",
          sourceKey: "tenants/acme/spaces/board-pack/plans/kickoff.md",
        }),
        expect.objectContaining({
          owner: "space",
          path: "Spaces/board-pack/knowledge/board.md",
          sourceKey: "tenants/acme/spaces/board-pack/knowledge/board.md",
        }),
        expect.objectContaining({
          owner: "space",
          path: "Spaces/board-pack/skills/ratio-review/SKILL.md",
          sourceKey:
            "tenants/acme/spaces/board-pack/skills/ratio-review/SKILL.md",
        }),
        expect.objectContaining({
          owner: "user",
          path: "User/USER.md",
          sourceKey: "tenants/acme/users/eric/USER.md",
        }),
        expect.objectContaining({
          owner: "user",
          path: "User/knowledge-pack.md",
          sourceKey: "tenants/acme/users/eric/knowledge-pack.md",
        }),
        expect.objectContaining({
          owner: "user",
          path: "User/memory/preferences.md",
          sourceKey: "tenants/acme/users/eric/memory/preferences.md",
        }),
        expect.objectContaining({
          owner: "thread_notes",
          path: "Thread/notes/findings.md",
          sourceKey: "tenants/acme/threads/thread-1/notes/findings.md",
          sourcePath: "notes/findings.md",
        }),
      ]),
    );
    expect(result.hydrateManifest.files).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "Spaces/INDEX.md" }),
        expect.objectContaining({ path: "SPACE_CONTEXT.md" }),
        expect.objectContaining({ path: "effective-policy.json" }),
        expect.objectContaining({ path: "space/SPACE.md" }),
        expect.objectContaining({ path: "spaces/old/SPACE.md" }),
        expect.objectContaining({ path: "Agent/AGENTS.md" }),
        expect.objectContaining({ path: "Agent/workspace/LEGACY.md" }),
        expect.objectContaining({ path: "Spaces/board-pack/TOOLS.md" }),
        expect.objectContaining({ path: "User/TOOLS.md" }),
        expect.objectContaining({
          path: "User/memory/.snapshots/run-1/memory.md",
        }),
        expect.objectContaining({ path: "User/memory/working/2026-05-22.md" }),
        expect.objectContaining({
          path: "User/memory/reports/thread-idle/run-1.md",
        }),
      ]),
    );
    expect(result.hydrateManifest.statusMounts).toEqual([
      expect.objectContaining({
        path: "Thread/THREAD.md",
        source: "database",
        readOnly: true,
        available: false,
      }),
      expect.objectContaining({
        path: "Thread/GOAL.md",
        source: "database",
        readOnly: true,
        available: false,
      }),
      expect.objectContaining({
        path: "Thread/PROGRESS.md",
        source: "database",
        readOnly: true,
        available: false,
      }),
      expect.objectContaining({
        path: "Thread/TASKS.md",
        source: "database",
        readOnly: true,
        available: false,
      }),
    ]);
    expect(result.effectivePolicy).toMatchObject({
      blockedTools: [],
      mcpAllowedServers: null,
      mcpBlockedServers: [],
      modelRouting: [],
    });

    const putKeys = store.puts.map((put) => put.key);
    expect(
      putKeys.filter((k) => !k.includes("/.agents-md-history/")).sort(),
    ).toEqual([
      "tenants/acme/threads/thread-1/.hydrate_manifest.json",
      "tenants/acme/threads/thread-1/.rendered_at",
      "tenants/acme/threads/thread-1/AGENTS.md",
    ]);
    // one write-once, content-addressed copy of this render's AGENTS.md
    expect(
      putKeys.filter((k) => k.includes("/.agents-md-history/")),
    ).toHaveLength(1);
    const manifestPut = store.puts.find((put) =>
      put.key.endsWith(".hydrate_manifest.json"),
    );
    expect(JSON.parse(manifestPut?.content ?? "{}")).toMatchObject({
      renderedPrefix: "tenants/acme/threads/thread-1/",
      files: expect.arrayContaining([
        expect.objectContaining({
          path: "Spaces/board-pack/knowledge/board.md",
          sourceKey: "tenants/acme/spaces/board-pack/knowledge/board.md",
        }),
      ]),
    });

    const agentsMdPut = store.puts.find((put) =>
      put.key.endsWith("/AGENTS.md"),
    );
    const composed = agentsMdPut?.content ?? "";
    const markerIndex = composed.indexOf(WORKSPACE_ROUTING_MARKER);
    expect(markerIndex).toBeGreaterThan(0);
    expect(composed.slice(0, markerIndex)).toContain("Root routing.");
    expect(composed).toContain(
      "- Board Pack — `Spaces/board-pack/` (active, hydrated)",
    );
    expect(composed).toContain("- Eric — `User/` (acting user, hydrated)");
    // The baseline fixture carries a stale legacy generated section
    // ("<!-- RENDERED:ACTIVE_SPACE -->\n\nold"); composition truncates it.
    expect(composed).not.toContain("RENDERED:ACTIVE_SPACE");
    expect(composed).not.toContain("\nold");
  });

  it("writes a write-once content-addressed AGENTS.md history copy recoverable by sha", async () => {
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

    const agentsMd =
      store.puts.find((put) => put.key.endsWith("/AGENTS.md"))?.content ?? "";
    const sha = agentsMdContentSha(agentsMd);
    const historyKey = agentsMdHistoryKey(result.renderedPrefix, sha);
    // The immutable copy holds the exact bytes of this turn's AGENTS.md.
    const recovered = await store.getText({ key: historyKey });
    expect(recovered).toBe(agentsMd);
    expect(recovered).toContain(WORKSPACE_ROUTING_MARKER);
  });

  it("recomposes the generated AGENTS.md idempotently across renders", async () => {
    const store = new FakeStore(seedObjects());
    const deps = {
      bucket: "workspace",
      repository: new FakeRepository(TUPLE),
      objectStore: store,
      now: () => new Date("2026-05-22T10:00:00.000Z"),
    };

    await renderWorkspaceTuple(
      { tenantId: "tenant-1", agentId: "agent-1", spaceId: "space-1" },
      deps,
    );
    const first = store.puts.find((put) => put.key.endsWith("/AGENTS.md"));
    store.puts.length = 0;
    // Touch a source file so the second render is a cache miss.
    store.setObject("tenants/acme/spaces/board-pack/CONTEXT.md", {
      content: "# Space Context v2\n",
      lastModified: "2026-05-22T12:30:00.000Z",
    });

    await renderWorkspaceTuple(
      { tenantId: "tenant-1", agentId: "agent-1", spaceId: "space-1" },
      { ...deps, now: () => new Date("2026-05-22T13:00:00.000Z") },
    );
    const second = store.puts.find((put) => put.key.endsWith("/AGENTS.md"));

    expect(second?.content).toBe(first?.content);
    expect(second?.content.split(WORKSPACE_ROUTING_MARKER)).toHaveLength(2);
  });

  it("lists authorized Spaces, participants, and profiles in the routing section", async () => {
    const store = new FakeStore(seedObjects());

    await renderWorkspaceTuple(
      { tenantId: "tenant-1", agentId: "agent-1", spaceId: "space-1" },
      {
        bucket: "workspace",
        repository: new FakeRepository(TUPLE, {
          authorizedSpaces: [
            {
              id: "space-1",
              slug: "board-pack",
              name: "Board Pack",
              accessMode: "public",
              isActive: true,
            },
            {
              id: "space-2",
              slug: "legal-review",
              name: "Legal Review",
              accessMode: "private",
              isActive: false,
            },
          ],
          participants: [
            { id: "user-2", name: "Alice", slug: "alice" },
            { id: "user-1", name: "Eric", slug: "eric" },
          ],
          agentProfiles: [
            {
              id: "profile-1",
              slug: "researcher",
              name: "Researcher",
              routingGuidance: "Deep research tasks",
            },
            {
              id: "profile-2",
              slug: "writer",
              name: "Writer",
              routingGuidance: null,
            },
          ],
        }),
        objectStore: store,
        now: () => new Date("2026-05-22T10:00:00.000Z"),
      },
    );

    const composed =
      store.puts.find((put) => put.key.endsWith("/AGENTS.md"))?.content ?? "";
    // AE1: authorized Space B appears with its folder path; spaces the
    // repository did not authorize are simply absent.
    expect(composed).toContain(
      "- Legal Review — `Spaces/legal-review/` (private; not currently hydrated)",
    );
    expect(composed).not.toContain("secret-space");
    expect(composed).toContain("### Active Space Participants");
    // Participants render with their fetchable Users/<slug>/ mount path —
    // the top-level plural root, never the acting user's writable User/.
    expect(composed).toContain(
      "- Alice — `Users/alice/` (not currently hydrated)",
    );
    expect(composed).toContain(
      "- Eric — `Users/eric/` (not currently hydrated)",
    );
    expect(composed).not.toContain("`User/alice/`");
    expect(composed).toContain("- Researcher — Deep research tasks");
    expect(composed).toContain("- Writer");
  });

  it("busts the render cache when routing membership changes without source mtime drift", async () => {
    const store = new FakeStore(seedObjects());
    const baseDeps = {
      bucket: "workspace",
      objectStore: store,
      now: () => new Date("2026-05-22T10:00:00.000Z"),
    };

    await renderWorkspaceTuple(
      { tenantId: "tenant-1", agentId: "agent-1", spaceId: "space-1" },
      { ...baseDeps, repository: new FakeRepository(TUPLE) },
    );
    store.puts.length = 0;

    // No S3 mtimes change; only the DB-derived authorized-space set grows.
    const result = await renderWorkspaceTuple(
      { tenantId: "tenant-1", agentId: "agent-1", spaceId: "space-1" },
      {
        ...baseDeps,
        now: () => new Date("2026-05-22T10:05:00.000Z"),
        repository: new FakeRepository(TUPLE, {
          authorizedSpaces: [
            {
              id: "space-1",
              slug: "board-pack",
              name: "Board Pack",
              accessMode: "public",
              isActive: true,
            },
            {
              id: "space-2",
              slug: "legal-review",
              name: "Legal Review",
              accessMode: "private",
              isActive: false,
            },
          ],
        }),
      },
    );

    expect(result.cacheStatus).toBe("miss");
    const composed =
      store.puts.find((put) => put.key.endsWith("/AGENTS.md"))?.content ?? "";
    expect(composed).toContain("Spaces/legal-review/");
  });

  it("composes model routing from agent, Space, active workspace, and user TOOLS.md", async () => {
    const store = new FakeStore(
      seedObjects({
        "tenants/acme/agents/finance-agent/TOOLS.md": {
          content: `---
modelRouting:
  - tool: workspace_skill
    match:
      slug: financial-analysis
    model: haiku
---
# Agent Tools
`,
        },
        "tenants/acme/spaces/board-pack/TOOLS.md": {
          content: `---
modelRouting:
  - tool: workspace_skill
    match:
      slug: financial-analysis
    model: sonnet
    reason: Board-pack analysis needs stronger synthesis
---
# Space Tools
`,
        },
        "tenants/acme/agents/finance-agent/workspaces/financial-analysis/TOOLS.md":
          {
            content: `---
modelRouting:
  - tool: workspace_skill
    match:
      slug: financial-analysis
    model: workspace-sonnet
  - tool: workspace_skill
    match:
      slug: workspace-only
    model: workspace-haiku
---
# Workspace Tools
`,
          },
        "tenants/acme/users/eric/TOOLS.md": {
          content: `---
modelRouting:
  - tool: workspace_skill
    match:
      slug: financial-analysis
    model: opus
---
# User Tools
`,
        },
      }),
    );

    const result = await renderWorkspaceTuple(
      {
        tenantId: "tenant-1",
        agentId: "agent-1",
        spaceId: "space-1",
        activeWorkspacePath: "workspaces/financial-analysis",
      },
      {
        bucket: "workspace",
        repository: new FakeRepository(TUPLE),
        objectStore: store,
        now: () => new Date("2026-05-22T10:00:00.000Z"),
      },
    );

    expect(result.effectivePolicy.modelRouting).toEqual([
      {
        tool: "workspace_skill",
        match: { slug: "financial-analysis" },
        model: "opus",
        sourcePath: "User/TOOLS.md",
        sourceOwner: "user",
        precedence: 40,
      },
      {
        tool: "workspace_skill",
        match: { slug: "workspace-only" },
        model: "workspace-haiku",
        sourcePath: "workspaces/financial-analysis/TOOLS.md",
        sourceOwner: "workspace",
        precedence: 30,
      },
    ]);
    expect(result.hydrateManifest.files).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "Spaces/board-pack/TOOLS.md" }),
        expect.objectContaining({ path: "User/TOOLS.md" }),
      ]),
    );
  });

  it("diagnoses a requested active workspace TOOLS.md policy that is missing", async () => {
    const store = new FakeStore(seedObjects());

    const result = await renderWorkspaceTuple(
      {
        tenantId: "tenant-1",
        agentId: "agent-1",
        spaceId: "space-1",
        activeWorkspacePath: "workspaces/missing",
      },
      {
        bucket: "workspace",
        repository: new FakeRepository(TUPLE),
        objectStore: store,
      },
    );

    expect(result.effectivePolicy.diagnostics).toContain(
      "tools_md_workspace_policy_missing:workspaces/missing/TOOLS.md",
    );
  });

  it("mounts rendered status files read-only while exposing narrative goal files as writable", async () => {
    const store = new FakeStore(seedObjects());
    store.setObject("tenants/acme/threads/customer-kickoff/GOAL.md", {
      content: "# Goal\n",
      lastModified: "2026-05-22T09:08:00.000Z",
      etag: '"goal-db"',
    });
    store.setObject("tenants/acme/threads/customer-kickoff/THREAD.md", {
      content: "# Thread\n",
      lastModified: "2026-05-22T09:07:00.000Z",
      etag: '"thread-db"',
    });
    store.setObject("tenants/acme/threads/customer-kickoff/PROGRESS.md", {
      content: "# Progress\n",
      lastModified: "2026-05-22T09:09:00.000Z",
      etag: '"progress-db"',
    });
    store.setObject("tenants/acme/threads/customer-kickoff/TASKS.md", {
      content: "# Tasks\n",
      lastModified: "2026-05-22T09:09:30.000Z",
      etag: '"tasks-db"',
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
        path: "Thread/THREAD.md",
        available: true,
        sourceKey: "tenants/acme/threads/customer-kickoff/THREAD.md",
        etag: '"thread-db"',
        readOnly: true,
      }),
      expect.objectContaining({
        path: "Thread/GOAL.md",
        available: true,
        sourceKey: "tenants/acme/threads/customer-kickoff/GOAL.md",
        etag: '"goal-db"',
        readOnly: true,
      }),
      expect.objectContaining({
        path: "Thread/PROGRESS.md",
        available: true,
        sourceKey: "tenants/acme/threads/customer-kickoff/PROGRESS.md",
        etag: '"progress-db"',
        readOnly: true,
      }),
      expect.objectContaining({
        path: "Thread/TASKS.md",
        available: true,
        sourceKey: "tenants/acme/threads/customer-kickoff/TASKS.md",
        etag: '"tasks-db"',
        readOnly: true,
      }),
    ]);
    expect(result.hydrateManifest.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "Thread/DECISIONS.md",
          owner: "thread_goal",
          sourceKey: "tenants/acme/threads/customer-kickoff/DECISIONS.md",
          etag: '"decisions-file"',
        }),
      ]),
    );
    expect(result.hydrateManifest.files).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "Thread/GOAL.md" }),
        expect.objectContaining({ path: "Thread/PROGRESS.md" }),
        expect.objectContaining({ path: "Thread/TASKS.md" }),
        expect.objectContaining({ path: "Thread/THREAD.md" }),
      ]),
    );
  });

  it("returns a cache hit without writes when the marker is newer than source files", async () => {
    const store = new FakeStore(seedObjects());
    const repository = new FakeRepository(TUPLE);

    await renderWorkspaceTuple(
      { tenantId: "tenant-1", agentId: "agent-1", spaceId: "space-1" },
      {
        bucket: "workspace",
        repository,
        objectStore: store,
        now: () => new Date("2026-05-22T13:00:00.000Z"),
      },
    );
    store.puts.length = 0;

    const result = await renderWorkspaceTuple(
      { tenantId: "tenant-1", agentId: "agent-1", spaceId: "space-1" },
      {
        bucket: "workspace",
        repository,
        objectStore: store,
        now: () => new Date("2026-05-22T13:10:00.000Z"),
      },
    );

    expect(result.cacheStatus).toBe("hit");
    expect(result.effectivePolicy.blockedTools).toEqual([]);
    expect(result.writtenFiles).toEqual([]);
    expect(result.hydrateManifest.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "Spaces/board-pack/CONTEXT.md",
          sourceKey: "tenants/acme/spaces/board-pack/CONTEXT.md",
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
    expect(result.writtenFiles).toEqual([
      "AGENTS.md",
      ".hydrate_manifest.json",
    ]);
    const manifestPut = store.puts.find((put) =>
      put.key.endsWith(".hydrate_manifest.json"),
    );
    expect(JSON.parse(manifestPut?.content ?? "{}")).toMatchObject({
      sources: expect.arrayContaining([
        { owner: "thread_goal", prefix: "tenants/acme/threads/thread-1/" },
        { owner: "thread_notes", prefix: "tenants/acme/threads/thread-1/" },
      ]),
      statusMounts: expect.arrayContaining([
        expect.objectContaining({
          path: "Thread/THREAD.md",
          source: "database",
          provider: "thread-goals",
          readOnly: true,
        }),
        expect.objectContaining({
          path: "Thread/PROGRESS.md",
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
    expect(result.writtenFiles).toEqual([
      "AGENTS.md",
      ".hydrate_manifest.json",
    ]);
    const putKeys = store.puts.map((put) => put.key);
    expect(
      putKeys.filter((k) => !k.includes("/.agents-md-history/")).sort(),
    ).toEqual([
      "tenants/acme/threads/thread-1/.hydrate_manifest.json",
      "tenants/acme/threads/thread-1/.rendered_at",
      "tenants/acme/threads/thread-1/AGENTS.md",
    ]);
    // one write-once, content-addressed copy of this render's AGENTS.md
    expect(
      putKeys.filter((k) => k.includes("/.agents-md-history/")),
    ).toHaveLength(1);
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
    store.setObject("tenants/acme/spaces/board-pack/CONTEXT.md", {
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
          path: "Spaces/board-pack/CONTEXT.md",
          sourceKey: "tenants/acme/spaces/board-pack/CONTEXT.md",
          etag: '"space-v2"',
          lastModified: "2026-05-22T10:30:00.000Z",
        }),
      ]),
    );
    const putKeys = store.puts.map((put) => put.key);
    expect(
      putKeys.filter((k) => !k.includes("/.agents-md-history/")).sort(),
    ).toEqual([
      "tenants/acme/threads/thread-1/.hydrate_manifest.json",
      "tenants/acme/threads/thread-1/.rendered_at",
      "tenants/acme/threads/thread-1/AGENTS.md",
    ]);
    // one write-once, content-addressed copy of this render's AGENTS.md
    expect(
      putKeys.filter((k) => k.includes("/.agents-md-history/")),
    ).toHaveLength(1);
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
          invokingServiceIdentity: spaceTriggerServiceIdentity({
            tenantId: "tenant-1",
            spaceId: "space-1",
          }),
        },
        {
          bucket: "workspace",
          repository: new FakeRepository({
            ...TUPLE,
            spaceAccessMode: "private",
            userId: null,
          }),
          objectStore: serviceStore,
          spaceMembershipRepository: new FakeMembershipRepository([]),
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
    expect(result.writtenFiles).toEqual([
      "AGENTS.md",
      ".hydrate_manifest.json",
    ]);
    expect(result.hydrateManifest.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          owner: "agent",
          path: "AGENTS.md",
          sourceKey: "tenants/acme/threads/thread-1/AGENTS.md",
          readOnly: true,
          generated: true,
        }),
        expect.objectContaining({ owner: "user", path: "User/USER.md" }),
      ]),
    );
    expect(result.hydrateManifest.files).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "Spaces/INDEX.md" }),
        expect.objectContaining({ path: "Thread/THREAD.md" }),
        expect.objectContaining({ path: "Thread/GOAL.md" }),
        expect.objectContaining({ path: "Thread/PROGRESS.md" }),
        expect.objectContaining({ path: "Thread/TASKS.md" }),
        expect.objectContaining({
          path: "Spaces/board-pack/CONTEXT.md",
          owner: "space",
        }),
      ]),
    );
    expect(
      result.hydrateManifest.statusMounts.map((mount) => mount.path),
    ).toEqual([
      "Thread/THREAD.md",
      "Thread/GOAL.md",
      "Thread/PROGRESS.md",
      "Thread/TASKS.md",
    ]);
  });

  it("renders the routing section without user entries for a userless default-Space tuple", async () => {
    const store = new FakeStore(seedObjects());
    store.deletePrefix("tenants/acme/spaces/board-pack/");

    const result = await renderWorkspaceTuple(
      { tenantId: "tenant-1", agentId: "agent-1", spaceId: "default-space" },
      {
        bucket: "workspace",
        repository: new FakeRepository({
          ...DEFAULT_SPACE_TUPLE,
          userId: null,
          userSlug: null,
          userName: null,
        }),
        objectStore: store,
        now: () => new Date("2026-05-22T10:00:00.000Z"),
      },
    );

    expect(result.cacheStatus).toBe("miss");
    const composed =
      store.puts.find((put) => put.key.endsWith("/AGENTS.md"))?.content ?? "";
    expect(composed).toContain(WORKSPACE_ROUTING_MARKER);
    expect(composed).toContain(
      "- Default — `Spaces/default/` (active, hydrated)",
    );
    expect(composed).not.toContain("### User");
    expect(composed).not.toContain("### Active Space Participants");
    expect(composed).not.toContain("### Agent Profiles");
  });
});
