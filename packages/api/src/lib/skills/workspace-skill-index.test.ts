/**
 * Workspace skill index tests (capability-mapping plan U10, KTD-8).
 * Contract: presence = `skills/<slug>/SKILL.md` markers, enabled/config =
 * `.assignment.json` (missing file = enabled), built-in slugs excluded,
 * unresolvable bucket/prefix → null (caller-owned degradation).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, mockGetConfig, mockPrefix } = vi.hoisted(() => ({
  store: new Map<string, string>(),
  mockGetConfig: vi.fn(),
  mockPrefix: vi.fn(),
}));

vi.mock("@thinkwork/runtime-config", () => ({ getConfig: mockGetConfig }));

vi.mock("@aws-sdk/client-s3", () => {
  class GetObjectCommand {
    constructor(public input: { Bucket: string; Key: string }) {}
  }
  class ListObjectsV2Command {
    constructor(
      public input: {
        Bucket: string;
        Prefix: string;
        ContinuationToken?: string;
      },
    ) {}
  }
  class S3Client {
    async send(command: {
      input: { Key?: string; Prefix?: string };
    }): Promise<unknown> {
      if (command instanceof ListObjectsV2Command) {
        const prefix = command.input.Prefix ?? "";
        return {
          Contents: [...store.keys()]
            .filter((key) => key.startsWith(prefix))
            .map((key) => ({ Key: key })),
          IsTruncated: false,
        };
      }
      const body = store.get(command.input.Key ?? "");
      if (body === undefined) {
        const err = new Error("no such key");
        (err as { name: string }).name = "NoSuchKey";
        throw err;
      }
      return { Body: { transformToString: async () => body } };
    }
  }
  return { S3Client, GetObjectCommand, ListObjectsV2Command };
});

vi.mock("./assignment-state.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("./assignment-state.js")>();
  return { ...original, resolveAgentWorkspacePrefix: mockPrefix };
});

import {
  listAgentWorkspaceSkills,
  listEnabledAgentWorkspaceSkillSlugs,
  listWorkspaceSkillSlugs,
} from "./workspace-skill-index.js";

const PREFIX = "tenants/acme/agents/ada/";

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  mockGetConfig.mockReturnValue("workspace-bucket");
  mockPrefix.mockResolvedValue(PREFIX);
});

function installSkill(slug: string, state?: Record<string, unknown>) {
  store.set(`${PREFIX}skills/${slug}/SKILL.md`, `---\nname: ${slug}\n---\n`);
  if (state) {
    store.set(
      `${PREFIX}skills/${slug}/.assignment.json`,
      JSON.stringify({ slug, updated_at: "2026-07-02T00:00:00Z", ...state }),
    );
  }
}

describe("listWorkspaceSkillSlugs", () => {
  it("lists SKILL.md markers, sorted, excluding built-ins and nested files", async () => {
    installSkill("zeta-skill");
    installSkill("alpha-skill");
    store.set(`${PREFIX}skills/web-search/SKILL.md`, "builtin"); // built-in slug
    store.set(`${PREFIX}skills/no-marker/notes.md`, "not a marker");
    store.set(`${PREFIX}skills/nested/deep/SKILL.md`, "not directly under");
    expect(await listWorkspaceSkillSlugs(PREFIX)).toEqual([
      "alpha-skill",
      "zeta-skill",
    ]);
  });

  it("returns null when WORKSPACE_BUCKET is unconfigured", async () => {
    mockGetConfig.mockReturnValue("");
    expect(await listWorkspaceSkillSlugs(PREFIX)).toBeNull();
  });
});

describe("listAgentWorkspaceSkills", () => {
  it("missing assignment file means enabled with no per-assignment state", async () => {
    installSkill("plain-skill");
    const skills = await listAgentWorkspaceSkills("agent-1");
    expect(skills).toEqual([
      {
        slug: "plain-skill",
        enabled: true,
        config: null,
        permissions: null,
        rateLimitRpm: null,
        modelOverride: null,
      },
    ]);
  });

  it("surfaces assignment-state enabled/config/permissions", async () => {
    installSkill("google-email", {
      enabled: false,
      config: { connectionId: "conn-1" },
      permissions: { operations: ["createAgent"] },
      rate_limit_rpm: 10,
    });
    const skills = await listAgentWorkspaceSkills("agent-1");
    expect(skills).toEqual([
      {
        slug: "google-email",
        enabled: false,
        config: { connectionId: "conn-1" },
        permissions: { operations: ["createAgent"] },
        rateLimitRpm: 10,
        modelOverride: null,
      },
    ]);
  });

  it("returns null when the agent has no resolvable workspace prefix", async () => {
    mockPrefix.mockResolvedValue(null);
    expect(await listAgentWorkspaceSkills("agent-1")).toBeNull();
  });
});

describe("listEnabledAgentWorkspaceSkillSlugs", () => {
  it("filters disabled assignments", async () => {
    installSkill("on-skill");
    installSkill("off-skill", { enabled: false });
    expect(await listEnabledAgentWorkspaceSkillSlugs("agent-1")).toEqual([
      "on-skill",
    ]);
  });
});
