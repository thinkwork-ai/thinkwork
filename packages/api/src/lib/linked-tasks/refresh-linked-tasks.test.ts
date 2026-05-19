import { describe, expect, it, vi } from "vitest";

import type { LastMileTaskSnapshot } from "../lastmile/tasks-adapter.js";
import type {
  LinkedTaskMirrorRow,
  LinkedTaskSyncRepository,
} from "./sync-linked-task.js";
import {
  type LinkedTaskRefreshRepository,
  refreshLinkedTasks,
} from "./refresh-linked-tasks.js";

const task: LinkedTaskMirrorRow = {
  id: "linked-1",
  tenantId: "tenant-1",
  spaceId: "space-1",
  threadId: "thread-1",
  provider: "lastmile",
  externalTaskId: "LM-1",
  externalTaskUrl: null,
  title: "Run credit report",
  required: true,
  status: "todo",
  blocked: false,
  syncStatus: "synced",
  assigneeDisplay: null,
  assigneeExternalId: null,
  metadata: null,
};

describe("refreshLinkedTasks", () => {
  it("reads provider snapshots and repairs stale mirrored state", async () => {
    const syncRepo = makeSyncRepository([task]);
    const refreshRepo = makeRefreshRepository(["LM-1"]);
    const adapter = {
      readTask: vi.fn(async () => ({
        ok: true as const,
        value: snapshot({ status: "completed" }),
      })),
    };

    await expect(
      refreshLinkedTasks(
        { tenantId: "tenant-1", threadId: "thread-1" },
        {
          refreshRepository: refreshRepo,
          taskAdapter: adapter,
          syncRepository: syncRepo.repository,
        },
      ),
    ).resolves.toEqual({
      checked: 1,
      updated: 1,
      failed: 0,
      skipped: 0,
    });
    expect(syncRepo.tasks[0]).toMatchObject({ status: "completed" });
    expect(syncRepo.events.map((event) => event.eventType)).toEqual([
      "completed",
    ]);
  });

  it("marks provider read failures as sync errors", async () => {
    const syncRepo = makeSyncRepository([task]);
    const refreshRepo = makeRefreshRepository(["LM-1"]);
    const adapter = {
      readTask: vi.fn(async () => ({
        ok: false as const,
        providerError: {
          code: "MCP_CALL_FAILED",
          message: "LastMile unavailable",
          retryable: true,
        },
      })),
    };

    const result = await refreshLinkedTasks(
      { tenantId: "tenant-1" },
      {
        refreshRepository: refreshRepo,
        taskAdapter: adapter,
        syncRepository: syncRepo.repository,
      },
    );

    expect(result).toEqual({
      checked: 1,
      updated: 0,
      failed: 1,
      skipped: 0,
    });
    expect(syncRepo.tasks[0]).toMatchObject({ syncStatus: "error" });
    expect(syncRepo.events[0]).toMatchObject({ eventType: "sync_failed" });
  });
});

function snapshot(
  overrides: Partial<LastMileTaskSnapshot>,
): LastMileTaskSnapshot {
  return {
    externalTaskId: "LM-1",
    externalTaskUrl: "https://tasks.example/LM-1",
    title: "Run credit report",
    status: "todo",
    blocked: false,
    syncStatus: "synced",
    assignee: null,
    dueAt: null,
    idempotent: false,
    needsTriage: false,
    raw: {},
    ...overrides,
  };
}

function makeRefreshRepository(
  externalTaskIds: string[],
): LinkedTaskRefreshRepository {
  return {
    async listCandidates(input) {
      return externalTaskIds.map((externalTaskId) => ({
        tenantId: input.tenantId,
        threadId: input.threadId ?? "thread-1",
        externalTaskId,
      }));
    },
  };
}

function makeSyncRepository(initialTasks: LinkedTaskMirrorRow[]) {
  const state = {
    tasks: initialTasks.map((item) => ({ ...item })),
    events: [] as any[],
    messages: [] as any[],
  };
  const repository: LinkedTaskSyncRepository = {
    async findByExternalTaskId(input) {
      return (
        state.tasks.find(
          (item) =>
            item.tenantId === input.tenantId &&
            item.provider === input.provider &&
            item.externalTaskId === input.externalTaskId,
        ) ?? null
      );
    },
    async listThreadTasks(input) {
      return state.tasks.filter(
        (item) =>
          item.tenantId === input.tenantId && item.threadId === input.threadId,
      );
    },
    async updateLinkedTask(input) {
      const index = state.tasks.findIndex((item) => item.id === input.task.id);
      const current = state.tasks[index]!;
      const updated = {
        ...current,
        title: input.update.title ?? current.title,
        externalTaskUrl:
          input.update.externalTaskUrl === undefined
            ? current.externalTaskUrl
            : input.update.externalTaskUrl,
        status: input.update.status,
        blocked: input.update.blocked,
        syncStatus: input.update.syncStatus,
        assigneeDisplay:
          input.update.assigneeDisplay === undefined
            ? current.assigneeDisplay
            : input.update.assigneeDisplay,
        assigneeExternalId:
          input.update.assigneeExternalId === undefined
            ? current.assigneeExternalId
            : input.update.assigneeExternalId,
        metadata: input.update.metadata,
      };
      state.tasks[index] = updated;
      return updated;
    },
    async createMilestoneEvent(input) {
      state.events.push(input);
      return true;
    },
    async createThreadMilestone(input) {
      state.messages.push(input);
    },
  };
  return { ...state, repository };
}
