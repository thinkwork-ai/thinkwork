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
      provider: "lastmile",
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
    });
    expect(result).toMatchObject({
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
        workflowTrigger: {
          triggerFamily: "webhook",
          triggerSource: "task-event:lastmile",
          actorType: "connected_app",
          idempotencyKey: "webhook:lastmile:evt-1",
          correlationId: "evt-1",
        },
      },
      delivery: {
        providerName: "lastmile",
        providerEventId: "evt-1",
        externalTaskId: "LM-1",
        normalizedKind: "task.completed",
        threadId: "thread-1",
      },
    });
  });

  it("syncs normalized Twenty status events into linked task mirrors", async () => {
    const result = await resolveTaskEvent({
      tenantId: TENANT,
      rawBody: JSON.stringify({
        schema: "thread-event-source.v1",
        provider: "twenty",
        eventType: "task.status_changed",
        eventId: "twenty-evt-1",
        externalTaskId: "twenty-task-1",
        status: "in_progress",
        title: "Review security addendum",
        externalTaskUrl: "https://twenty.example/tasks/twenty-task-1",
        occurredAt: "2026-06-17T18:00:00Z",
      }),
    });

    expect(mockSyncLinkedTaskFromProviderEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        provider: "twenty",
        externalTaskId: "twenty-task-1",
        externalEventId: "twenty-evt-1",
        eventName: "task.status_changed",
        status: "in_progress",
        title: "Review security addendum",
        externalTaskUrl: "https://twenty.example/tasks/twenty-task-1",
        occurredAt: "2026-06-17T18:00:00Z",
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      handled: true,
    });
  });

  it("syncs normalized Twenty comments as external CRM content", async () => {
    await resolveTaskEvent({
      tenantId: TENANT,
      rawBody: JSON.stringify({
        schema: "thread-event-source.v1",
        provider: "twenty",
        kind: "task.comment_added",
        eventId: "twenty-comment-1",
        externalTaskId: "twenty-task-1",
        actor: {
          id: "person-1",
          displayName: "Ada Lovelace",
        },
        comment: {
          id: "comment-1",
          body: "Customer confirmed the launch date.",
        },
      }),
    });

    expect(mockSyncLinkedTaskFromProviderEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "twenty",
        externalTaskId: "twenty-task-1",
        externalEventId: "twenty-comment-1",
        eventName: "task.comment_added",
        comment: {
          id: "comment-1",
          body: "Customer confirmed the launch date.",
          authorName: "Ada Lovelace",
          authorId: "person-1",
        },
      }),
    );
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
        event: "task.viewed",
        eventId: "evt-viewed",
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
        eventId: "evt-missing-task",
        taskId: "foreign-task",
      }),
    });
    expect(result).toMatchObject({
      ok: true,
      skip: true,
      reason: "linked task mirror not found",
      delivery: {
        providerName: "lastmile",
        providerEventId: "evt-missing-task",
        externalTaskId: "foreign-task",
        normalizedKind: "task.completed",
      },
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
      rawBody: JSON.stringify({ event: "task.completed", eventId: "evt-3" }),
    });
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      message: "externalTaskId or taskId is required",
    });
  });

  it("returns 400 when a relevant event has no event id", async () => {
    const result = await resolveTaskEvent({
      tenantId: TENANT,
      rawBody: JSON.stringify({
        event: "task.completed",
        taskId: "LM-1",
      }),
    });
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      message: "eventId or externalEventId is required",
    });
  });

  it("returns 400 for unsupported providers", async () => {
    const result = await resolveTaskEvent({
      tenantId: TENANT,
      rawBody: JSON.stringify({
        provider: "linear",
        event: "task.completed",
        eventId: "evt-linear",
        taskId: "LIN-1",
      }),
    });
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      message: "provider must be lastmile or twenty",
    });
  });
});
