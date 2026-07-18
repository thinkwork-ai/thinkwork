import { describe, expect, it, vi } from "vitest";
import type { RenderedWorkspaceTuple } from "../workspace-renderer/types.js";
import {
  listAuthorizedWorkspaceSkills,
  loadAuthorizedWorkspaceSkill,
  WorkspaceSkillAccessError,
} from "./workspace-tools.js";

const context = {
  tenantId: "tenant-1",
  userId: "user-alice",
  agentId: "agent-1",
  threadId: "thread-1",
  turnId: "turn-1",
  spaceId: "space-1",
};

function rendered(
  active: Array<{
    name: string;
    slug: string;
    class: "skill";
    source_scope?: string;
  }>,
  files: Array<{
    owner: "agent" | "space" | "user";
    sourceKey: string;
    sourcePrefix: string;
    sourcePath: string;
    path: string;
    size?: number;
  }>,
): RenderedWorkspaceTuple {
  return {
    renderedPrefix: "tenants/acme/threads/thread-1/",
    cacheStatus: "miss",
    sourcePrefixes: [],
    writtenFiles: [],
    hydrateManifest: {
      version: 1,
      renderedPrefix: "tenants/acme/threads/thread-1/",
      generatedAt: "2026-07-18T00:00:00.000Z",
      sources: [],
      files: files.map((file) => ({ ...file, readOnly: false })),
      statusMounts: [],
    },
    capabilities: {
      fingerprint: "manifest-1",
      path: "capabilities/manifest-1.json",
      manifest: {
        version: 1,
        fingerprint: "manifest-1",
        input_signature: "input-1",
        generated_at: "2026-07-18T00:00:00.000Z",
        agent: { tenant_id: "tenant-1", agent_slug: "agent" },
        active,
        withheld: [],
        signature: null,
      },
    },
    activeSpace: {
      id: "space-1",
      slug: "default",
      name: "Default",
      isDefault: true,
    },
    effectivePolicy: {
      blockedTools: [],
      allowedTools: null,
      mcpAllowedServers: null,
      mcpBlockedServers: [],
      modelRouting: [],
      diagnostics: [],
    },
    user: { id: "user-alice", slug: "alice", name: "Alice" },
  };
}

function file(
  owner: "agent" | "space" | "user",
  slug: string,
  sourceKey: string,
) {
  return {
    owner,
    path:
      owner === "agent"
        ? `skills/${slug}/SKILL.md`
        : `${owner === "space" ? "Space" : "User"}/skills/${slug}/SKILL.md`,
    sourceKey,
    sourcePrefix: sourceKey.slice(0, -`skills/${slug}/SKILL.md`.length),
    sourcePath: `skills/${slug}/SKILL.md`,
  };
}

describe("AgentCore governed workspace skills", () => {
  it("lists only manifest-authorized skills with matching exact-user sources", async () => {
    const projection = rendered(
      [
        {
          name: "alice-private",
          slug: "alice-private",
          class: "skill",
          source_scope: "user:user-alice",
        },
        {
          name: "space-shared",
          slug: "space-shared",
          class: "skill",
          source_scope: "space:space-1",
        },
        {
          name: "foreign-private",
          slug: "foreign-private",
          class: "skill",
          source_scope: "user:user-bob",
        },
      ],
      [
        file(
          "user",
          "alice-private",
          "tenants/acme/users/alice/skills/alice-private/SKILL.md",
        ),
        file(
          "space",
          "space-shared",
          "tenants/acme/spaces/default/skills/space-shared/SKILL.md",
        ),
        file(
          "user",
          "foreign-private",
          "tenants/acme/users/bob/skills/foreign-private/SKILL.md",
        ),
      ],
    );
    const render = vi.fn(async () => projection);

    await expect(
      listAuthorizedWorkspaceSkills(context, { render }),
    ).resolves.toEqual({
      manifestFingerprint: "manifest-1",
      skills: [
        { slug: "alice-private", scope: "user" },
        { slug: "space-shared", scope: "space" },
      ],
    });
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        userId: "user-alice",
        spaceId: "space-1",
        threadId: "thread-1",
      }),
    );
  });

  it("re-renders canonical state on every load and denies a revoked skill", async () => {
    const allowed = rendered(
      [
        {
          name: "alice-private",
          slug: "alice-private",
          class: "skill",
          source_scope: "user:user-alice",
        },
      ],
      [
        file(
          "user",
          "alice-private",
          "tenants/acme/users/alice/skills/alice-private/SKILL.md",
        ),
      ],
    );
    const revoked = rendered(
      [],
      allowed.hydrateManifest.files as Parameters<typeof rendered>[1],
    );
    const render = vi
      .fn()
      .mockResolvedValueOnce(allowed)
      .mockResolvedValueOnce(revoked);
    const readText = vi.fn(
      async () => "# Alice private\nUse the CRM safely.\n",
    );

    await expect(
      loadAuthorizedWorkspaceSkill(context, "alice-private", {
        render,
        readText,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        slug: "alice-private",
        scope: "user",
        content: "# Alice private\nUse the CRM safely.\n",
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    await expect(
      loadAuthorizedWorkspaceSkill(context, "alice-private", {
        render,
        readText,
      }),
    ).rejects.toMatchObject({ code: "workspace_skill_not_authorized" });
    expect(render).toHaveBeenCalledTimes(2);
    expect(readText).toHaveBeenCalledTimes(1);
  });

  it.each(["../secret", "skill/../../secret", "", "A skill"])(
    "rejects malformed skill identifiers before reading: %j",
    async (slug) => {
      const render = vi.fn();
      const readText = vi.fn();
      await expect(
        loadAuthorizedWorkspaceSkill(context, slug, { render, readText }),
      ).rejects.toBeInstanceOf(WorkspaceSkillAccessError);
      expect(render).not.toHaveBeenCalled();
      expect(readText).not.toHaveBeenCalled();
    },
  );

  it("fails closed on credential-shaped skill content without echoing it", async () => {
    const projection = rendered(
      [
        {
          name: "unsafe",
          slug: "unsafe",
          class: "skill",
          source_scope: "agent:agent-1",
        },
      ],
      [
        file(
          "agent",
          "unsafe",
          "tenants/acme/agents/main/skills/unsafe/SKILL.md",
        ),
      ],
    );
    const raw = "# Unsafe\napi_key=do-not-expose-this\n";
    const error = await loadAuthorizedWorkspaceSkill(context, "unsafe", {
      render: async () => projection,
      readText: async () => raw,
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "workspace_skill_content_blocked" });
    expect(String(error)).not.toContain("do-not-expose-this");
  });

  it("rejects oversized skill bodies before returning model-visible content", async () => {
    const source = file(
      "agent",
      "large",
      "tenants/acme/agents/main/skills/large/SKILL.md",
    );
    const projection = rendered(
      [
        {
          name: "large",
          slug: "large",
          class: "skill",
          source_scope: "agent:agent-1",
        },
      ],
      [{ ...source, size: 70_000 }],
    );
    const readText = vi.fn();

    await expect(
      loadAuthorizedWorkspaceSkill(context, "large", {
        render: async () => projection,
        readText,
      }),
    ).rejects.toMatchObject({ code: "workspace_skill_too_large" });
    expect(readText).not.toHaveBeenCalled();
  });

  it("rejects a cross-tenant S3 source even when the manifest names the skill", async () => {
    const projection = rendered(
      [
        {
          name: "foreign-source",
          slug: "foreign-source",
          class: "skill",
          source_scope: "user:user-alice",
        },
      ],
      [
        file(
          "user",
          "foreign-source",
          "tenants/other/users/alice/skills/foreign-source/SKILL.md",
        ),
      ],
    );
    const readText = vi.fn();

    await expect(
      loadAuthorizedWorkspaceSkill(context, "foreign-source", {
        render: async () => projection,
        readText,
      }),
    ).rejects.toMatchObject({ code: "workspace_skill_not_authorized" });
    expect(readText).not.toHaveBeenCalled();
  });
});
