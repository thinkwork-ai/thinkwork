import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectQueue: [] as Array<unknown[]>,
  updates: [] as Array<Record<string, unknown>>,
  s3Send: vi.fn(),
  enqueueComputerTask: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", () => {
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
  return { GetObjectCommand, ListObjectsV2Command, S3Client };
});

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          where: () => ({
            limit: async () => mocks.selectQueue.shift() ?? [],
          }),
        }),
        where: () => ({
          limit: async () => mocks.selectQueue.shift() ?? [],
        }),
      }),
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

import { ensureMigratedComputerWorkspaceSeeded } from "./workspace-seed.js";

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
    mocks.s3Send.mockImplementation(async (command: {
      input: Record<string, unknown>;
    }) => {
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
    });

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
