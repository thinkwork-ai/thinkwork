import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindGoal, mockReadGoalFile, captures, tables, mockDb } = vi.hoisted(
  () => {
    const tables = {
      tenants: {
        id: { __column__: "tenants.id" },
        slug: { __column__: "tenants.slug" },
        __table__: "tenants",
      },
    };
    const captures = {
      tenantRows: [] as Record<string, unknown>[],
      readInputs: [] as Record<string, unknown>[],
    };
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => captures.tenantRows),
          })),
        })),
      })),
    };
    return {
      captures,
      mockDb: db,
      mockFindGoal: vi.fn(async () => null as Record<string, unknown> | null),
      mockReadGoalFile: vi.fn(
        async (input: Record<string, unknown>): Promise<string | null> => {
          captures.readInputs.push(input);
          return `${input.file} content`;
        },
      ),
      tables,
    };
  },
);

vi.mock("../../utils.js", () => ({
  db: mockDb,
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  tenants: tables.tenants,
}));

vi.mock("./threadGoal.query.js", () => ({
  findThreadGoalForVisibleThread: mockFindGoal,
}));

vi.mock("../../../lib/thread-goals/storage.js", () => ({
  THREAD_GOAL_REQUIRED_FILES: [
    "THREAD.md",
    "GOAL.md",
    "PROGRESS.md",
    "TASKS.md",
    "DECISIONS.md",
    "ARTIFACTS.md",
    "HANDOFFS.md",
  ],
  readThreadGoalFile: mockReadGoalFile,
  threadGoalFileKey: (input: Record<string, unknown>) =>
    `tenants/${input.tenantSlug}/threads/${
      input.threadFolderName ?? input.threadId
    }/${input.file}`,
}));

import { threadGoalFiles } from "./threadGoalFiles.query.js";

const ctx = { auth: { authType: "cognito" } } as any;

beforeEach(() => {
  captures.tenantRows.length = 0;
  captures.readInputs.length = 0;
  mockDb.select.mockClear();
  mockFindGoal.mockReset();
  mockFindGoal.mockResolvedValue(null);
  mockReadGoalFile.mockClear();
});

describe("threadGoalFiles", () => {
  it("returns the visible Goal row plus bounded v1 markdown files", async () => {
    mockFindGoal.mockResolvedValue({
      id: "goal-1",
      threadId: "thread-1",
      workspaceFolderName: "customer-kickoff",
      status: "IN_REVIEW",
    });
    captures.tenantRows.push({ slug: "acme" });

    const result = await threadGoalFiles(
      null,
      { tenantId: "tenant-1", threadId: "thread-1" },
      ctx,
    );

    expect(result?.goal).toMatchObject({ id: "goal-1" });
    expect(result?.files).toEqual([
      {
        file: "THREAD",
        key: "tenants/acme/threads/customer-kickoff/THREAD.md",
        content: "THREAD.md content",
      },
      {
        file: "GOAL",
        key: "tenants/acme/threads/customer-kickoff/GOAL.md",
        content: "GOAL.md content",
      },
      {
        file: "PROGRESS",
        key: "tenants/acme/threads/customer-kickoff/PROGRESS.md",
        content: "PROGRESS.md content",
      },
      {
        file: "TASKS",
        key: "tenants/acme/threads/customer-kickoff/TASKS.md",
        content: "TASKS.md content",
      },
      {
        file: "DECISIONS",
        key: "tenants/acme/threads/customer-kickoff/DECISIONS.md",
        content: "DECISIONS.md content",
      },
      {
        file: "ARTIFACTS",
        key: "tenants/acme/threads/customer-kickoff/ARTIFACTS.md",
        content: "ARTIFACTS.md content",
      },
      {
        file: "HANDOFFS",
        key: "tenants/acme/threads/customer-kickoff/HANDOFFS.md",
        content: "HANDOFFS.md content",
      },
    ]);
    expect(captures.readInputs[0]).toMatchObject({
      threadFolderName: "customer-kickoff",
    });
  });

  it("returns null for a visible legacy Thread with no Goal row", async () => {
    await expect(
      threadGoalFiles(
        null,
        { tenantId: "tenant-1", threadId: "thread-1" },
        ctx,
      ),
    ).resolves.toBeNull();
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(mockReadGoalFile).not.toHaveBeenCalled();
  });

  it("keeps missing files as null content entries", async () => {
    mockFindGoal.mockResolvedValue({ id: "goal-1", threadId: "thread-1" });
    captures.tenantRows.push({ slug: "acme" });
    mockReadGoalFile.mockImplementation(
      async (input: Record<string, unknown>) =>
        input.file === "DECISIONS.md" ? null : `${input.file} content`,
    );

    const result = await threadGoalFiles(
      null,
      { tenantId: "tenant-1", threadId: "thread-1" },
      ctx,
    );

    expect(
      result?.files.find((file) => file.file === "DECISIONS"),
    ).toMatchObject({
      key: "tenants/acme/threads/thread-1/DECISIONS.md",
      content: null,
    });
  });
});
