import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectQueue: [] as Array<unknown[]>,
  s3Send: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", () => {
  class GetObjectCommand {
    constructor(public readonly input: Record<string, unknown>) {}
  }
  class HeadObjectCommand {
    constructor(public readonly input: Record<string, unknown>) {}
  }
  class PutObjectCommand {
    constructor(public readonly input: Record<string, unknown>) {}
  }
  class S3Client {
    send(command: unknown) {
      return mocks.s3Send(command);
    }
  }
  return { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client };
});

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          leftJoin: () => ({
            where: () => ({
              limit: async () => mocks.selectQueue.shift() ?? [],
            }),
          }),
        }),
      }),
    }),
  }),
}));

import { ensureArtifactBuilderDefaults } from "./artifact-builder-defaults.js";

const TARGET_ROW = {
  migrated_from_agent_id: "agent-1",
  agent_slug: "computer-source-agent",
  tenant_slug: "tenant-slug",
};

const LEGACY_ARTIFACT_BUILDER_SKILL = `---
name: artifact-builder
description: Builds reusable ThinkWork Computer applets and interactive artifacts from research prompts. Use when the user asks to build, create, generate, or make a dashboard, applet, report, briefing, workspace, or other interactive surface.
---

# Artifact Builder

Use this skill when the user wants Computer to produce an interactive, reusable artifact. The expected output is a saved applet, not just a prose answer.

## Contract

1. Research with the available tools and thread context.
2. If live sources are missing or partial, keep going with the best available workspace, memory, context, web, or fixture data. Show missing or partial source status inside the applet.
3. Generate TSX using \`@thinkwork/computer-stdlib\` primitives and \`@thinkwork/ui\`.
4. Export a deterministic \`refresh()\` function whenever the result should be refreshable. Refresh must rerun saved source queries or deterministic transforms; it must not reinterpret the whole user request.
5. Call \`save_app\` before responding. Pass at least \`name\`, \`files\`, and \`metadata\`.
6. Include \`threadId\`, \`prompt\`, \`agentVersion\`, and \`modelId\` in metadata when available.
7. After \`save_app\` returns \`ok\`, answer concisely with what was created and the \`/artifacts/{appId}\` route.

## Applet Shape

Use \`App.tsx\` as the main file. Export one default React component. Prefer concise component-local data transforms over large abstractions. Do not use network calls, browser globals, dynamic imports, \`eval\`, or raw HTML injection.

Good applets include:

- Header with title, summary, and source badges.
- KPI strip for key totals.
- Charts or tables that make comparison easy.
- Evidence or source-status sections so users can inspect what drove the result.
- Empty, partial, and failed-source states.

## Missing Data

Missing data is not a reason to stop before creating the artifact. Create a runnable applet that makes source gaps explicit, then ask for source setup or approval as a follow-up when needed.

For the LastMile CRM pipeline risk prompt, build an applet that covers stale activity, stage exposure, and top risks. If live LastMile CRM records are unavailable, use the canonical LastMile-shaped structure and mark CRM/email/calendar/web source coverage honestly.
`;

describe("ensureArtifactBuilderDefaults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectQueue = [];
    process.env.WORKSPACE_BUCKET = "workspace-bucket";
  });

  it("creates the Artifact Builder skill and CRM recipe when both are missing", async () => {
    mocks.selectQueue = [[TARGET_ROW]];
    mocks.s3Send.mockImplementation(
      async (command: { input: Record<string, unknown> }) => {
        if ("Body" in command.input) return {};
        throw Object.assign(new Error("missing"), {
          name: "NotFound",
          $metadata: { httpStatusCode: 404 },
        });
      },
    );

    const result = await ensureArtifactBuilderDefaults({
      tenantId: "tenant-1",
      computerId: "computer-1",
    });

    expect(result).toMatchObject({
      ensured: true,
      written: [
        "skills/artifact-builder/SKILL.md",
        "skills/artifact-builder/references/crm-dashboard.md",
      ],
      skipped: [],
    });
    const puts = mocks.s3Send.mock.calls
      .map(([command]) => (command as { input: Record<string, unknown> }).input)
      .filter((input) => "Body" in input);
    expect(puts).toHaveLength(2);
    expect(puts[0]).toMatchObject({
      Bucket: "workspace-bucket",
      Key: "tenants/tenant-slug/agents/computer-source-agent/workspace/skills/artifact-builder/SKILL.md",
      ContentType: "text/markdown",
    });
    expect(String(puts[0]?.Body)).toContain("references/crm-dashboard.md");
    expect(puts[1]).toMatchObject({
      Key: "tenants/tenant-slug/agents/computer-source-agent/workspace/skills/artifact-builder/references/crm-dashboard.md",
    });
    expect(String(puts[1]?.Body)).toContain("interface CrmDashboardData");
  });

  it("does not overwrite an existing SKILL.md while adding the missing CRM recipe", async () => {
    mocks.selectQueue = [[TARGET_ROW]];
    mocks.s3Send.mockImplementation(
      async (command: { input: Record<string, unknown> }) => {
        if ("Body" in command.input) return {};
        const key = String(command.input.Key);
        if (key.endsWith("SKILL.md")) {
          return {
            Body: {
              transformToString: async () => "# Custom Artifact Builder\n",
            },
          };
        }
        throw Object.assign(new Error("missing"), {
          name: "NoSuchKey",
          $metadata: { httpStatusCode: 404 },
        });
      },
    );

    const result = await ensureArtifactBuilderDefaults({
      tenantId: "tenant-1",
      computerId: "computer-1",
    });

    expect(result).toMatchObject({
      ensured: true,
      written: ["skills/artifact-builder/references/crm-dashboard.md"],
      updated: [],
      skipped: ["skills/artifact-builder/SKILL.md"],
    });
    const puts = mocks.s3Send.mock.calls
      .map(([command]) => (command as { input: Record<string, unknown> }).input)
      .filter((input) => "Body" in input);
    expect(puts).toHaveLength(1);
    expect(String(puts[0]?.Key)).toContain("references/crm-dashboard.md");
  });

  it("updates the exact old platform SKILL.md while preserving custom skills", async () => {
    mocks.selectQueue = [[TARGET_ROW]];
    mocks.s3Send.mockImplementation(
      async (command: { input: Record<string, unknown> }) => {
        if ("Body" in command.input) return {};
        const key = String(command.input.Key);
        if (key.endsWith("SKILL.md")) {
          return {
            Body: {
              transformToString: async () => LEGACY_ARTIFACT_BUILDER_SKILL,
            },
          };
        }
        return {};
      },
    );

    const result = await ensureArtifactBuilderDefaults({
      tenantId: "tenant-1",
      computerId: "computer-1",
    });

    expect(result).toMatchObject({
      ensured: true,
      written: [],
      updated: ["skills/artifact-builder/SKILL.md"],
      skipped: ["skills/artifact-builder/references/crm-dashboard.md"],
    });
    const puts = mocks.s3Send.mock.calls
      .map(([command]) => (command as { input: Record<string, unknown> }).input)
      .filter((input) => "Body" in input);
    expect(puts).toHaveLength(1);
    expect(String(puts[0]?.Key)).toContain("SKILL.md");
    expect(String(puts[0]?.Body)).toContain("references/crm-dashboard.md");
  });

  it("is a no-op when both Artifact Builder files already exist", async () => {
    mocks.selectQueue = [[TARGET_ROW]];
    mocks.s3Send.mockResolvedValue({});

    const result = await ensureArtifactBuilderDefaults({
      tenantId: "tenant-1",
      computerId: "computer-1",
    });

    expect(result).toMatchObject({
      ensured: true,
      written: [],
      updated: [],
      skipped: [
        "skills/artifact-builder/SKILL.md",
        "skills/artifact-builder/references/crm-dashboard.md",
      ],
    });
    expect(
      mocks.s3Send.mock.calls.some(
        ([command]) =>
          "Body" in (command as { input: Record<string, unknown> }).input,
      ),
    ).toBe(false);
  });

  it("skips computers without a backing agent", async () => {
    mocks.selectQueue = [
      [
        {
          migrated_from_agent_id: null,
          agent_slug: null,
          tenant_slug: "tenant-slug",
        },
      ],
    ];

    const result = await ensureArtifactBuilderDefaults({
      tenantId: "tenant-1",
      computerId: "computer-1",
    });

    expect(result).toEqual({
      ensured: false,
      reason: "missing_backing_agent",
    });
    expect(mocks.s3Send).not.toHaveBeenCalled();
  });
});
