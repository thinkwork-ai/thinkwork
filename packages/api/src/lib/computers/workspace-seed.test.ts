import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectQueue: [] as Array<unknown[]>,
  updates: [] as Array<Record<string, unknown>>,
  s3Send: vi.fn(),
  enqueueComputerTask: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", () => {
  class CopyObjectCommand {
    constructor(public readonly input: Record<string, unknown>) {}
  }
  class GetObjectCommand {
    constructor(public readonly input: Record<string, unknown>) {}
  }
  class ListObjectsV2Command {
    constructor(public readonly input: Record<string, unknown>) {}
  }
  class S3Client {
    send(command: unknown) {
      return mocks.s3Send(command);
    }
  }
  return {
    CopyObjectCommand,
    GetObjectCommand,
    ListObjectsV2Command,
    S3Client,
  };
});

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: () => ({
      from: () => {
        const chain = {
          leftJoin: () => chain,
          innerJoin: () => chain,
          where: () => ({
            limit: async () => mocks.selectQueue.shift() ?? [],
          }),
        };
        return chain;
      },
    }),
    update: () => ({
      set: (value: Record<string, unknown>) => {
        mocks.updates.push(value);
        return {
          where: async () => [],
        };
      },
    }),
  }),
}));

vi.mock("./tasks.js", () => ({
  enqueueComputerTask: mocks.enqueueComputerTask,
}));

import {
  ensureDefaultComputerRunbookSkillsMaterialized,
  ensureMigratedComputerWorkspaceSeeded,
} from "./workspace-seed.js";

describe("ensureMigratedComputerWorkspaceSeeded", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectQueue = [];
    mocks.updates = [];
    process.env.WORKSPACE_BUCKET = "workspace-bucket";
  });

  it("enqueues migrated source agent workspace files for the Computer", async () => {
    mocks.selectQueue = [
      [
        {
          id: "computer-1",
          tenant_id: "tenant-1",
          migrated_from_agent_id: "agent-1",
          migration_metadata: null,
        },
      ],
      [{ agent_slug: "source-agent", tenant_slug: "tenant-slug" }],
    ];
    mocks.s3Send.mockImplementation(
      async (command: { input: Record<string, unknown> }) => {
        if ("Prefix" in command.input) {
          return {
            Contents: [
              {
                Key: "tenants/tenant-slug/agents/source-agent/workspace/AGENTS.md",
                ETag: '"etag-agents"',
                Size: 12,
              },
              {
                Key: "tenants/tenant-slug/agents/source-agent/workspace/memory/contacts.md",
                ETag: '"etag-contacts"',
                Size: 8,
              },
              {
                Key: "tenants/tenant-slug/agents/source-agent/workspace/manifest.json",
                Size: 2,
              },
              {
                Key: "tenants/tenant-slug/agents/source-agent/workspace/skills/web-search/tool.md",
                Size: 4,
              },
              {
                Key: "tenants/tenant-slug/agents/source-agent/workspace/empty.md",
                Size: 0,
              },
              {
                Key: "tenants/tenant-slug/agents/source-agent/workspace/spaces.md",
                Size: 3,
              },
              {
                Key: "tenants/tenant-slug/agents/source-agent/workspace/big.md",
                Size: 256 * 1024 + 1,
              },
            ],
          };
        }

        const key = String(command.input.Key);
        const body = key.endsWith("spaces.md")
          ? "   "
          : key.endsWith("AGENTS.md")
            ? "agent instructions"
            : "contacts";
        return {
          Body: {
            transformToString: async () => body,
          },
        };
      },
    );

    const result = await ensureMigratedComputerWorkspaceSeeded({
      tenantId: "tenant-1",
      computerId: "computer-1",
    });

    expect(result).toEqual({ seeded: true, enqueued: 2, skipped: 3 });
    expect(mocks.enqueueComputerTask).toHaveBeenCalledTimes(2);
    expect(mocks.enqueueComputerTask).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        taskType: "workspace_file_write",
        taskInput: { path: "AGENTS.md", content: "agent instructions" },
      }),
    );
    expect(mocks.enqueueComputerTask).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        taskType: "workspace_file_write",
        taskInput: { path: "memory/contacts.md", content: "contacts" },
      }),
    );
    expect(mocks.updates[0]?.migration_metadata).toMatchObject({
      efsWorkspaceSeed: {
        sourceAgentId: "agent-1",
        sourceAgentSlug: "source-agent",
        enqueued: 2,
        skipped: 3,
      },
    });
  });

  it("does not enqueue again when the same source agent has already seeded", async () => {
    mocks.selectQueue = [
      [
        {
          id: "computer-1",
          tenant_id: "tenant-1",
          migrated_from_agent_id: "agent-1",
          migration_metadata: {
            efsWorkspaceSeed: { sourceAgentId: "agent-1" },
          },
        },
      ],
    ];

    const result = await ensureMigratedComputerWorkspaceSeeded({
      tenantId: "tenant-1",
      computerId: "computer-1",
    });

    expect(result).toEqual({ seeded: false, reason: "already_seeded" });
    expect(mocks.s3Send).not.toHaveBeenCalled();
    expect(mocks.enqueueComputerTask).not.toHaveBeenCalled();
  });
});

describe("ensureDefaultComputerRunbookSkillsMaterialized", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectQueue = [];
    mocks.updates = [];
    process.env.WORKSPACE_BUCKET = "workspace-bucket";
  });

  it("copies default runbook skills into the template workspace and enqueues EFS writes", async () => {
    mocks.selectQueue = [
      [
        {
          id: "computer-1",
          tenant_id: "tenant-1",
          tenant_slug: "tenant-slug",
          template_tenant_id: null,
          template_slug: "thinkwork-computer-default",
          template_source: "system",
          template_kind: "computer",
        },
      ],
    ];
    mocks.s3Send.mockImplementation(
      async (command: { input: Record<string, unknown> }) => {
        if ("Prefix" in command.input) {
          const prefix = String(command.input.Prefix);
          const skillSlug = prefix.split("/")[2];
          return {
            Contents: [
              {
                Key: `${prefix}SKILL.md`,
                ETag: `"etag-${skillSlug}-skill"`,
                Size: 42,
              },
              {
                Key: `${prefix}references/thinkwork-runbook.json`,
                ETag: `"etag-${skillSlug}-contract"`,
                Size: 24,
              },
              {
                Key: `${prefix}empty.md`,
                ETag: `"etag-${skillSlug}-empty"`,
                Size: 0,
              },
            ],
          };
        }

        if ("CopySource" in command.input) return {};

        const key = String(command.input.Key);
        return {
          Body: {
            transformToString: async () =>
              key.endsWith("SKILL.md")
                ? "---\nname: test\n---\n"
                : JSON.stringify({ ok: true }),
          },
        };
      },
    );

    const result = await ensureDefaultComputerRunbookSkillsMaterialized({
      tenantId: "tenant-1",
      computerId: "computer-1",
    });

    expect(result).toEqual({
      seeded: true,
      copied: 6,
      enqueued: 6,
      skipped: 3,
    });
    const copyInputs = mocks.s3Send.mock.calls
      .map(([command]) => (command as { input: Record<string, unknown> }).input)
      .filter((input) => "CopySource" in input);
    expect(copyInputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          Bucket: "workspace-bucket",
          CopySource: "workspace-bucket/skills/catalog/crm-dashboard/SKILL.md",
          Key: "tenants/tenant-slug/agents/_catalog/thinkwork-computer-default/workspace/skills/crm-dashboard/SKILL.md",
        }),
        expect.objectContaining({
          CopySource:
            "workspace-bucket/skills/catalog/research-dashboard/SKILL.md",
          Key: "tenants/tenant-slug/agents/_catalog/thinkwork-computer-default/workspace/skills/research-dashboard/SKILL.md",
        }),
        expect.objectContaining({
          CopySource: "workspace-bucket/skills/catalog/map-artifact/SKILL.md",
          Key: "tenants/tenant-slug/agents/_catalog/thinkwork-computer-default/workspace/skills/map-artifact/SKILL.md",
        }),
      ]),
    );
    expect(mocks.enqueueComputerTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: "workspace_file_write",
        taskInput: {
          path: "skills/crm-dashboard/SKILL.md",
          content: "---\nname: test\n---\n",
        },
        idempotencyKey:
          "computer_default_runbook_skill:computer-1:crm-dashboard:SKILL.md:etag-crm-dashboard-skill",
      }),
    );
    expect(mocks.enqueueComputerTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskInput: {
          path: "skills/map-artifact/references/thinkwork-runbook.json",
          content: JSON.stringify({ ok: true }),
        },
      }),
    );
  });

  it("skips custom template Computers", async () => {
    mocks.selectQueue = [
      [
        {
          id: "computer-1",
          tenant_id: "tenant-1",
          tenant_slug: "tenant-slug",
          template_tenant_id: "tenant-1",
          template_slug: "custom-template",
          template_source: "user",
          template_kind: "computer",
        },
      ],
    ];

    const result = await ensureDefaultComputerRunbookSkillsMaterialized({
      tenantId: "tenant-1",
      computerId: "computer-1",
    });

    expect(result).toEqual({ seeded: false, reason: "non_default_template" });
    expect(mocks.s3Send).not.toHaveBeenCalled();
    expect(mocks.enqueueComputerTask).not.toHaveBeenCalled();
  });

  it("does not treat a tenant-authored same-slug template as the platform default", async () => {
    mocks.selectQueue = [
      [
        {
          id: "computer-1",
          tenant_id: "tenant-1",
          tenant_slug: "tenant-slug",
          template_tenant_id: "tenant-1",
          template_slug: "thinkwork-computer-default",
          template_source: "user",
          template_kind: "computer",
        },
      ],
    ];

    const result = await ensureDefaultComputerRunbookSkillsMaterialized({
      tenantId: "tenant-1",
      computerId: "computer-1",
    });

    expect(result).toEqual({ seeded: false, reason: "non_default_template" });
    expect(mocks.s3Send).not.toHaveBeenCalled();
    expect(mocks.enqueueComputerTask).not.toHaveBeenCalled();
  });
});
