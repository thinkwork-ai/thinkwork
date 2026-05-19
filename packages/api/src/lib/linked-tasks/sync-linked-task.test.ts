import { describe, expect, it } from "vitest";

import type { CoordinatorAgentService } from "../spaces/coordinator-agent.js";
import {
  type LinkedTaskMirrorRow,
  type LinkedTaskMilestoneInput,
  type LinkedTaskSyncRepository,
  markLinkedTaskSyncFailure,
  syncLinkedTaskFromProviderEvent,
} from "./sync-linked-task.js";

const baseTask: LinkedTaskMirrorRow = {
  id: "linked-1",
  tenantId: "tenant-1",
  spaceId: "space-1",
  threadId: "thread-1",
  provider: "lastmile",
  externalTaskId: "LM-1",
  externalTaskUrl: "https://tasks.example/LM-1",
  title: "Collect sales tax exemption",
  required: true,
  status: "todo",
  blocked: false,
  syncStatus: "synced",
  assigneeDisplay: "Accounting",
  assigneeExternalId: "acct-1",
  metadata: null,
};

describe("syncLinkedTaskFromProviderEvent", () => {
  it("updates a completed task and posts one Thread milestone", async () => {
    const repo = makeRepository([baseTask]);
    const coordinator = makeCoordinator();

    const result = await syncLinkedTaskFromProviderEvent(
      {
        tenantId: "tenant-1",
        externalTaskId: "LM-1",
        externalEventId: "evt-1",
        eventName: "task.completed",
        status: "completed",
        occurredAt: "2026-05-19T15:00:00Z",
      },
      { repository: repo, coordinator },
    );

    expect(result).toMatchObject({
      ok: true,
      skipped: false,
      eventType: "completed",
      milestonePosted: true,
      allRequiredComplete: true,
    });
    expect(repo.tasks[0]).toMatchObject({
      status: "completed",
      blocked: false,
      syncStatus: "synced",
    });
    expect(repo.events).toEqual([
      expect.objectContaining({
        eventType: "completed",
        externalEventId: "evt-1",
        previousStatus: "todo",
        newStatus: "completed",
        message: "Collect sales tax exemption completed.",
      }),
    ]);
    expect(repo.messages.map((message) => message.content)).toEqual([
      "Collect sales tax exemption completed.",
      "All required onboarding tasks are complete (1/1). @coordinator can prepare the final summary and archive recommendation.",
    ]);
    expect(coordinator.wakeups).toEqual([
      expect.objectContaining({
        tenantId: "tenant-1",
        spaceId: "space-1",
        threadId: "thread-1",
        reason: "completion_summary",
      }),
    ]);
  });

  it("coalesces duplicate external events without duplicate Thread milestones", async () => {
    const repo = makeRepository([baseTask]);

    await syncLinkedTaskFromProviderEvent(
      {
        tenantId: "tenant-1",
        externalTaskId: "LM-1",
        externalEventId: "evt-dupe",
        eventName: "task.completed",
        status: "completed",
      },
      { repository: repo, coordinator: makeCoordinator() },
    );
    const duplicate = await syncLinkedTaskFromProviderEvent(
      {
        tenantId: "tenant-1",
        externalTaskId: "LM-1",
        externalEventId: "evt-dupe",
        eventName: "task.completed",
        status: "completed",
      },
      { repository: repo, coordinator: makeCoordinator() },
    );

    expect(duplicate).toMatchObject({
      eventType: null,
      milestonePosted: false,
    });
    expect(repo.events).toHaveLength(1);
    expect(repo.messages).toHaveLength(2);
  });

  it("updates provider chatter without posting timeline noise", async () => {
    const repo = makeRepository([baseTask]);
    const coordinator = makeCoordinator();

    const result = await syncLinkedTaskFromProviderEvent(
      {
        tenantId: "tenant-1",
        externalTaskId: "LM-1",
        eventName: "task.updated",
        status: "in_progress",
      },
      { repository: repo, coordinator },
    );

    expect(result).toMatchObject({
      eventType: null,
      milestonePosted: false,
      allRequiredComplete: false,
    });
    expect(repo.tasks[0]).toMatchObject({ status: "in_progress" });
    expect(repo.events).toEqual([]);
    expect(repo.messages).toEqual([]);
    expect(coordinator.wakeups).toEqual([]);
  });

  it("records reassignment and due-date milestones when important fields change", async () => {
    const repo = makeRepository([baseTask]);

    await syncLinkedTaskFromProviderEvent(
      {
        tenantId: "tenant-1",
        externalTaskId: "LM-1",
        externalEventId: "evt-reassigned",
        eventName: "task.reassigned",
        status: "todo",
        assignee: {
          externalId: "finance-1",
          displayName: "Finance",
        },
      },
      { repository: repo, coordinator: makeCoordinator() },
    );
    await syncLinkedTaskFromProviderEvent(
      {
        tenantId: "tenant-1",
        externalTaskId: "LM-1",
        externalEventId: "evt-due",
        eventName: "task.due_date_changed",
        status: "todo",
        dueAt: "2026-05-25",
      },
      { repository: repo, coordinator: makeCoordinator() },
    );

    expect(repo.events.map((event) => event.eventType)).toEqual([
      "reassigned",
      "due_date_changed",
    ]);
    expect(repo.messages.map((message) => message.content)).toEqual([
      "Collect sales tax exemption reassigned to Finance.",
      "Collect sales tax exemption due date changed to 2026-05-25.",
    ]);
  });

  it("marks sync failures as linked task sync errors", async () => {
    const repo = makeRepository([baseTask]);

    const result = await markLinkedTaskSyncFailure(
      {
        tenantId: "tenant-1",
        externalTaskId: "LM-1",
        externalEventId: "evt-failed",
        message: "LastMile unavailable",
        code: "MCP_CALL_FAILED",
      },
      { repository: repo },
    );

    expect(result).toMatchObject({
      eventType: "sync_failed",
      milestonePosted: true,
    });
    expect(repo.tasks[0]).toMatchObject({ syncStatus: "error" });
    expect(repo.events[0]).toMatchObject({
      eventType: "sync_failed",
      message: "Collect sales tax exemption sync failed: LastMile unavailable",
    });
  });

  it("skips unknown external task ids", async () => {
    const repo = makeRepository([]);

    await expect(
      syncLinkedTaskFromProviderEvent(
        {
          tenantId: "tenant-1",
          externalTaskId: "missing",
          eventName: "task.completed",
          status: "completed",
        },
        { repository: repo, coordinator: makeCoordinator() },
      ),
    ).resolves.toMatchObject({
      ok: true,
      skipped: true,
      reason: "linked task mirror not found",
    });
  });
});

function makeRepository(initialTasks: LinkedTaskMirrorRow[]) {
  const state = {
    tasks: initialTasks.map((task) => ({ ...task })),
    events: [] as LinkedTaskMilestoneInput[],
    messages: [] as {
      tenantId: string;
      threadId: string;
      content: string;
      metadata: Record<string, unknown>;
    }[],
  };

  const repository = {
    ...state,
    async findByExternalTaskId(input) {
      return (
        state.tasks.find(
          (task) =>
            task.tenantId === input.tenantId &&
            task.provider === input.provider &&
            task.externalTaskId === input.externalTaskId,
        ) ?? null
      );
    },
    async listThreadTasks(input) {
      return state.tasks.filter(
        (task) =>
          task.tenantId === input.tenantId && task.threadId === input.threadId,
      );
    },
    async updateLinkedTask(input) {
      const index = state.tasks.findIndex((task) => task.id === input.task.id);
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
      if (
        input.externalEventId &&
        state.events.some(
          (event) => event.externalEventId === input.externalEventId,
        )
      ) {
        return false;
      }
      state.events.push(input);
      return true;
    },
    async createThreadMilestone(input) {
      state.messages.push(input);
    },
  } satisfies LinkedTaskSyncRepository & typeof state;

  return repository;
}

function makeCoordinator() {
  const coordinator = {
    wakeups: [] as Parameters<CoordinatorAgentService["enqueueWakeup"]>[0][],
    async enqueueWakeup(
      input: Parameters<CoordinatorAgentService["enqueueWakeup"]>[0],
    ) {
      coordinator.wakeups.push(input);
      return {
        ok: true as const,
        enqueued: true as const,
        wakeupRequestId: "wakeup-1",
        agentId: "agent-coordinator",
        assignmentId: "assignment-1",
      };
    },
  };
  return coordinator;
}
