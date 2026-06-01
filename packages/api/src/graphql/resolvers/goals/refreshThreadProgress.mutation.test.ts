import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  captures,
  mockDb,
  mockRefreshGoalFolder,
  mockResolveCallerTenantId,
  mockResolveCallerUserId,
  mockThreadGoalFiles,
  tables,
} = vi.hoisted(() => {
  const tables = {
    threads: {
      id: { __column__: "threads.id" },
      tenant_id: { __column__: "threads.tenant_id" },
      __table__: "threads",
    },
  };
  const captures = {
    threadRows: [] as Record<string, unknown>[],
  };
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => captures.threadRows),
        })),
      })),
    })),
  };
  return {
    captures,
    mockDb: db,
    mockRefreshGoalFolder: vi.fn(async () => [
      { key: "tenants/acme/threads/thread-1/PROGRESS.md", bytes: 128 },
    ]),
    mockResolveCallerTenantId: vi.fn(async () => "tenant-1"),
    mockResolveCallerUserId: vi.fn(async () => "user-1"),
    mockThreadGoalFiles: vi.fn(async () => ({
      goal: { id: "goal-1" },
      files: [{ file: "PROGRESS", content: "# PROGRESS" }],
    })),
    tables,
  };
});

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    and: vi.fn((...conditions: unknown[]) => ({ conditions })),
    db: mockDb,
    eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
    threads: tables.threads,
  };
});

vi.mock("../../../lib/spaces/customer-onboarding-goal-md.js", () => ({
  refreshCustomerOnboardingGoalFolder: mockRefreshGoalFolder,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: mockResolveCallerTenantId,
  resolveCallerUserId: mockResolveCallerUserId,
}));

vi.mock("../threads/access.js", () => ({
  callerVisibleThreadPredicate: vi.fn(() => ({ visible: true })),
}));

vi.mock("./threadGoalFiles.query.js", () => ({
  threadGoalFiles: mockThreadGoalFiles,
}));

import { refreshThreadProgress } from "./refreshThreadProgress.mutation.js";

const ctx = {
  auth: {
    authType: "cognito",
  },
} as any;

beforeEach(() => {
  captures.threadRows.length = 0;
  mockDb.select.mockClear();
  mockRefreshGoalFolder.mockClear();
  mockResolveCallerTenantId.mockReset();
  mockResolveCallerTenantId.mockResolvedValue("tenant-1");
  mockResolveCallerUserId.mockReset();
  mockResolveCallerUserId.mockResolvedValue("user-1");
  mockThreadGoalFiles.mockClear();
});

describe("refreshThreadProgress", () => {
  it("refreshes generated projections for a visible thread and returns files", async () => {
    captures.threadRows.push({ id: "thread-1" });

    await expect(
      refreshThreadProgress(
        null,
        { input: { tenantId: "tenant-1", threadId: "thread-1" } },
        ctx,
      ),
    ).resolves.toEqual({
      threadGoalFiles: {
        goal: { id: "goal-1" },
        files: [{ file: "PROGRESS", content: "# PROGRESS" }],
      },
    });

    expect(mockRefreshGoalFolder).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      threadId: "thread-1",
    });
    expect(mockThreadGoalFiles).toHaveBeenCalledWith(
      null,
      { tenantId: "tenant-1", threadId: "thread-1" },
      ctx,
    );
  });

  it("does not refresh when the caller cannot see the thread", async () => {
    await expect(
      refreshThreadProgress(
        null,
        { input: { tenantId: "tenant-1", threadId: "thread-1" } },
        ctx,
      ),
    ).resolves.toEqual({ threadGoalFiles: null });

    expect(mockRefreshGoalFolder).not.toHaveBeenCalled();
    expect(mockThreadGoalFiles).not.toHaveBeenCalled();
  });

  it("surfaces projection refresh failures", async () => {
    captures.threadRows.push({ id: "thread-1" });
    mockRefreshGoalFolder.mockRejectedValueOnce(new Error("s3 unavailable"));

    await expect(
      refreshThreadProgress(
        null,
        { input: { tenantId: "tenant-1", threadId: "thread-1" } },
        ctx,
      ),
    ).rejects.toMatchObject({
      message: "Failed to refresh thread progress.",
      extensions: { code: "THREAD_PROGRESS_REFRESH_FAILED" },
    });
  });
});
