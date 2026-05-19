/**
 * Focused resolver test for the task-event handler.
 *
 * Full HTTP-cycle coverage lives in webhook-shared.test.ts. This suite keeps
 * LastMile payload parsing and linked-task sync handoff honest.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSyncLinkedTaskFromProviderEvent } = vi.hoisted(() => ({
  mockSyncLinkedTaskFromProviderEvent: vi.fn(),
}));

vi.mock("../lib/linked-tasks/sync-linked-task.js", () => ({
  syncLinkedTaskFromProviderEvent: mockSyncLinkedTaskFromProviderEvent,
}));

const { resolveTaskEvent } = await import("../handlers/webhooks/task-event.js");

const TENANT = "tenant-a";

beforeEach(() => {
  vi.resetAllMocks();
  mockSyncLinkedTaskFromProviderEvent.mockResolvedValue({
    ok: true,
    skipped: false,
    linkedTask: {
      id: "linked-task-1",
      threadId: "thread-1",
      status: "completed",
      syncStatus: "synced",
    },
    eventType: "completed",
    milestonePosted: true,
    allRequiredComplete: true,
  });
});

describe("resolveTaskEvent", () => {
  it("syncs relevant LastMile task events into linked task mirrors", async () => {
    const result = await resolveTaskEvent({
      tenantId: TENANT,
      rawBody: JSON.stringify({
        event: "task.completed",
        eventId: "evt-1",
        taskId: "LM-1",
        status: "complete",
        title: "Collect sales tax exemption",
        url: "https://tasks.example/LM-1",
        occurredAt: "2026-05-19T15:00:00Z",
        assignee: {
          id: "acct-1",
          name: "Accounting",
        },
      }),
    });

    expect(mockSyncLinkedTaskFromProviderEvent).toHaveBeenCalledWith({
      tenantId: TENANT,
      externalTaskId: "LM-1",
      externalEventId: "evt-1",
      eventName: "task.completed",
      status: "complete",
      blocked: undefined,
      title: "Collect sales tax exemption",
      externalTaskUrl: "https://tasks.example/LM-1",
      assignee: {
        externalId: "acct-1",
        displayName: "Accounting",
      },
      dueAt: null,
      occurredAt: "2026-05-19T15:00:00Z",
      raw: expect.any(Object),
    });
    expect(result).toEqual({
      ok: true,
      handled: true,
      body: {
        linkedTaskId: "linked-task-1",
        threadId: "thread-1",
        status: "completed",
        syncStatus: "synced",
        eventType: "completed",
        milestonePosted: true,
        allRequiredComplete: true,
      },
    });
  });

  it("accepts nested task payloads from provider variants", async () => {
    await resolveTaskEvent({
      tenantId: TENANT,
      rawBody: JSON.stringify({
        event: "task.reassigned",
        externalEventId: "evt-2",
        task: {
          id: "LM-2",
          status: "todo",
          assignee: {
            userId: "finance-1",
            displayName: "Finance",
          },
        },
      }),
    });

    expect(mockSyncLinkedTaskFromProviderEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        externalTaskId: "LM-2",
        externalEventId: "evt-2",
        eventName: "task.reassigned",
        status: "todo",
        assignee: {
          externalId: "finance-1",
          displayName: "Finance",
        },
      }),
    );
  });

  it("skips events whose type is not task sync material", async () => {
    const result = await resolveTaskEvent({
      tenantId: TENANT,
      rawBody: JSON.stringify({
        event: "task.comment_added",
        taskId: "LM-1",
      }),
    });
    expect(result).toMatchObject({ ok: true, skip: true });
    expect(mockSyncLinkedTaskFromProviderEvent).not.toHaveBeenCalled();
  });

  it("skips task events for external tasks that ThinkWork does not mirror", async () => {
    mockSyncLinkedTaskFromProviderEvent.mockResolvedValueOnce({
      ok: true,
      skipped: true,
      reason: "linked task mirror not found",
    });

    const result = await resolveTaskEvent({
      tenantId: TENANT,
      rawBody: JSON.stringify({
        event: "task.completed",
        taskId: "foreign-task",
      }),
    });
    expect(result).toEqual({
      ok: true,
      skip: true,
      reason: "linked task mirror not found",
    });
  });

  it("returns 400 on malformed JSON", async () => {
    const result = await resolveTaskEvent({
      tenantId: TENANT,
      rawBody: "not json",
    });
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("returns 400 when a relevant event has no external task id", async () => {
    const result = await resolveTaskEvent({
      tenantId: TENANT,
      rawBody: JSON.stringify({ event: "task.completed" }),
    });
    expect(result).toEqual({
      ok: false,
      status: 400,
      message: "externalTaskId or taskId is required",
    });
  });
});
