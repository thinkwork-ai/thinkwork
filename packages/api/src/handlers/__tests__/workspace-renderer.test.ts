import { describe, expect, it } from "vitest";
import { createWorkspaceRendererHandler } from "../workspace-renderer.js";
import type { SpaceMembershipRepository } from "../../lib/workspace-renderer/space-membership-check.js";
import type {
  ResolvedWorkspaceRenderTuple,
  WorkspaceObjectMetadata,
  WorkspaceRendererObjectStore,
  WorkspaceTupleRepository,
} from "../../lib/workspace-renderer/index.js";

const TUPLE: ResolvedWorkspaceRenderTuple = {
  tenantId: "tenant-1",
  tenantSlug: "acme",
  agentId: "agent-1",
  agentSlug: "agent",
  agentName: "Agent",
  spaceId: "space-1",
  spaceSlug: "default",
  spaceName: "Default",
  spaceKind: "custom",
  spaceAccessMode: "public",
  spacePrompt: null,
  spaceToolPolicy: { blockedTools: ["send_email"] },
  spaceMcpPolicy: { blockedServers: ["prod-db"] },
  userId: null,
  userSlug: null,
  userName: null,
};

class FakeRepository implements WorkspaceTupleRepository {
  constructor(private readonly tuple: ResolvedWorkspaceRenderTuple = TUPLE) {}

  async resolve(): Promise<ResolvedWorkspaceRenderTuple> {
    return this.tuple;
  }
}

class FakeMembershipRepository implements SpaceMembershipRepository {
  async isSpaceMember(): Promise<boolean> {
    return false;
  }
}

class FakeStore implements WorkspaceRendererObjectStore {
  async listObjects(input: {
    prefix: string;
  }): Promise<WorkspaceObjectMetadata[]> {
    if (input.prefix.includes("/agents/")) {
      return [
        {
          key: `${input.prefix}AGENTS.md`,
          lastModified: new Date("2026-05-22T09:00:00.000Z"),
        },
      ];
    }
    return [
      {
        key: `${input.prefix}SPACE.md`,
        lastModified: new Date("2026-05-22T09:01:00.000Z"),
      },
    ];
  }

  async getText(input: { key: string }): Promise<string | null> {
    if (input.key.endsWith(".rendered_at")) return null;
    if (input.key.endsWith("SPACE.md")) return "# Default\n";
    return "# AGENTS.md\n";
  }

  async putText(): Promise<void> {}
}

describe("workspace-renderer handler", () => {
  it("renders a tuple from a direct Lambda invocation payload", async () => {
    const handler = createWorkspaceRendererHandler({
      bucket: "workspace",
      repository: new FakeRepository(),
      objectStore: new FakeStore(),
      now: () => new Date("2026-05-22T10:00:00.000Z"),
    });

    await expect(
      handler({
        tenantId: "tenant-1",
        agentId: "agent-1",
        spaceId: "space-1",
        agentBlockedTools: ["browser_automation"],
      }),
    ).resolves.toMatchObject({
      ok: true,
      statusCode: 200,
      renderedPrefix: "tenants/acme/rendered/agent/default/anon/",
      cacheStatus: "miss",
      effectivePolicy: {
        blockedTools: ["browser_automation"],
        mcpBlockedServers: [],
      },
    });
  });

  it("returns 403 when a private Space render is denied", async () => {
    const handler = createWorkspaceRendererHandler({
      bucket: "workspace",
      repository: new FakeRepository({
        ...TUPLE,
        spaceSlug: "finance",
        spaceName: "Finance",
        spaceKind: "custom",
        spaceAccessMode: "private",
        userId: "user-2",
      }),
      objectStore: new FakeStore(),
      spaceMembershipRepository: new FakeMembershipRepository(),
    });

    await expect(
      handler({
        tenantId: "tenant-1",
        agentId: "agent-1",
        spaceId: "space-1",
      }),
    ).resolves.toMatchObject({
      ok: false,
      statusCode: 403,
      error: { code: "SpaceAccessDenied" },
    });
  });

  it("returns a validation response for missing identifiers", async () => {
    const handler = createWorkspaceRendererHandler({ bucket: "workspace" });

    await expect(
      handler({ agentId: "agent-1", spaceId: "space-1" }),
    ).resolves.toMatchObject({
      ok: false,
      statusCode: 400,
      error: { code: "InvalidInput" },
    });
  });
});
