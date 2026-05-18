import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectRows: [] as any[],
  updateRows: [] as any[],
  updateSet: null as Record<string, unknown> | null,
  restoreRequesterMemorySnapshot: vi.fn(),
  syncRequesterMemoryToHindsight: vi.fn(),
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => mocks.selectRows,
        }),
      }),
    }),
    update: () => ({
      set: (value: Record<string, unknown>) => {
        mocks.updateSet = value;
        return {
          where: () => ({
            returning: async () => mocks.updateRows,
          }),
        };
      },
    }),
  }),
}));

vi.mock("./storage.js", () => ({
  restoreRequesterMemorySnapshot: mocks.restoreRequesterMemorySnapshot,
}));

vi.mock("./hindsight-sync.js", () => ({
  syncRequesterMemoryToHindsight: mocks.syncRequesterMemoryToHindsight,
}));

import {
  parseChangedFiles,
  rollbackRequesterIdleLearningRun,
} from "./rollback.js";

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    tenant_id: "tenant-1",
    thread_id: "thread-1",
    computer_id: "computer-1",
    requester_user_id: "user-1",
    scheduled_job_id: "job-1",
    activity_sequence: 3,
    scheduled_for: new Date("2026-05-18T12:15:00.000Z"),
    started_at: new Date("2026-05-18T12:15:01.000Z"),
    finished_at: new Date("2026-05-18T12:15:10.000Z"),
    status: "changed",
    changed_files: [
      {
        path: "memory/MEMORY.md",
        key: "tenants/tenant-1/users/user-1/memory/MEMORY.md",
        beforeHash: "before",
        afterHash: "after",
        beforeBytes: 10,
        afterBytes: 20,
        snapshotKey:
          "tenants/tenant-1/users/user-1/memory/.snapshots/run-1/memory%2FMEMORY.md.md",
      },
    ],
    candidate_summary: null,
    report_s3_key: "reports/run-1.md",
    error: null,
    budget: null,
    metadata: {},
    created_at: new Date("2026-05-18T12:15:01.000Z"),
    updated_at: new Date("2026-05-18T12:15:10.000Z"),
    ...overrides,
  };
}

describe("requester memory rollback", () => {
  beforeEach(() => {
    mocks.selectRows = [];
    mocks.updateRows = [];
    mocks.updateSet = null;
    mocks.restoreRequesterMemorySnapshot.mockReset();
    mocks.syncRequesterMemoryToHindsight.mockReset();
    mocks.syncRequesterMemoryToHindsight.mockResolvedValue({
      status: "success",
      files: [
        { path: "memory/MEMORY.md", documentId: "doc", status: "upserted" },
      ],
    });
  });

  it("parses changed files defensively", () => {
    expect(
      parseChangedFiles([
        {
          path: "memory/MEMORY.md",
          beforeBytes: 1,
          afterBytes: 2,
          evidenceMessageIds: ["message-1", 42],
        },
        null,
        { path: "" },
      ]),
    ).toEqual([
      expect.objectContaining({
        path: "memory/MEMORY.md",
        beforeBytes: 1,
        afterBytes: 2,
        evidenceMessageIds: ["message-1"],
      }),
    ]);
  });

  it("restores each changed file, syncs Hindsight, and marks the run rolled back", async () => {
    const original = runRow();
    const updated = runRow({ status: "rolled_back" });
    mocks.selectRows = [original];
    mocks.updateRows = [updated];

    const result = await rollbackRequesterIdleLearningRun({
      tenantId: "tenant-1",
      userId: "user-1",
      runId: "run-1",
    });

    expect(mocks.restoreRequesterMemorySnapshot).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      userId: "user-1",
      path: "memory/MEMORY.md",
      snapshotKey:
        "tenants/tenant-1/users/user-1/memory/.snapshots/run-1/memory%2FMEMORY.md.md",
    });
    expect(mocks.syncRequesterMemoryToHindsight).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        userId: "user-1",
        runId: "run-1",
        threadId: "thread-1",
      }),
    );
    expect(mocks.updateSet).toMatchObject({
      status: "rolled_back",
      error: null,
    });
    expect(mocks.updateSet?.metadata).toMatchObject({
      rollback: {
        restoredFiles: [
          {
            path: "memory/MEMORY.md",
            snapshotKey:
              "tenants/tenant-1/users/user-1/memory/.snapshots/run-1/memory%2FMEMORY.md.md",
          },
        ],
      },
    });
    expect(result.run.status).toBe("rolled_back");
  });
});
