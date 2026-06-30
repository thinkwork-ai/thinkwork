import { describe, expect, it } from "vitest";

import {
  describeWorkItemActivity,
  isWorkItemActivityTimelineEvent,
} from "./work-item-activity";
import type {
  WorkItemAssigneeSummary,
  WorkItemEventSummary,
  WorkItemStatusSummary,
  WorkItemSummary,
} from "./work-item-display";

const assignees: WorkItemAssigneeSummary[] = [
  { id: "user-eric", name: "Eric Odom", email: "eric@example.com" },
  { id: "user-amy", name: "Amy" },
];

const statuses: WorkItemStatusSummary[] = [
  { id: "todo", name: "Todo", category: "TODO" },
  {
    id: "done",
    name: "Done",
    category: "DONE",
    icon: "check-circle",
    color: "#22c55e",
  },
  { id: "blocked", name: "Blocked", category: "BLOCKED" },
];

const item: WorkItemSummary = {
  id: "work-1",
  spaceId: "space-1",
  statusId: "todo",
  status: statuses[0],
  title: "Send DocuSign package",
  priority: "NORMAL",
  ownerUserId: "user-eric",
  required: true,
  applicable: true,
  blocked: false,
};

function event(overrides: Partial<WorkItemEventSummary>): WorkItemEventSummary {
  return {
    id: "event-1",
    workItemId: item.id,
    eventType: "updated",
    createdAt: "2026-06-29T12:00:00.000Z",
    ...overrides,
  };
}

function describeActivity(overrides: Partial<WorkItemEventSummary>) {
  return describeWorkItemActivity({
    event: event(overrides),
    item,
    assignees,
    statuses,
  });
}

describe("work item activity helpers", () => {
  it("describes status movement with previous and next status names", () => {
    expect(
      describeActivity({
        actorUserId: "user-eric",
        eventType: "status_changed",
        previousStatusId: "todo",
        newStatusId: "done",
      }),
    ).toMatchObject({
      actorLabel: "Eric Odom",
      actionText: "moved from Todo to Done",
      iconKey: "status",
      statusIcon: "check-circle",
      statusColor: "#22c55e",
      statusCategory: "DONE",
      displayMode: "compact",
    });
  });

  it("describes assignment metadata with the new assignee name", () => {
    expect(
      describeActivity({
        actorUserId: "user-amy",
        eventType: "assigned",
        metadata: {
          fieldChanges: [
            {
              field: "owner_user_id",
              previousValue: null,
              newValue: "user-eric",
            },
          ],
          newAssigneeName: "Eric Odom",
        },
      }),
    ).toMatchObject({
      actorLabel: "Amy",
      actionText: "assigned to Eric Odom",
      iconKey: "assigned",
    });
  });

  it("falls back to the current owner for legacy assignee changes", () => {
    expect(
      describeActivity({
        actorUserId: "user-eric",
        eventType: "updated",
        metadata: { changedFields: ["owner_user_id", "updated_at"] },
      }),
    ).toMatchObject({
      actorLabel: "Eric Odom",
      actionText: "assigned to Eric Odom",
      iconKey: "assigned",
    });
  });

  it("describes priority changes from metadata instead of title-heavy messages", () => {
    expect(
      describeActivity({
        actorUserId: "user-eric",
        eventType: "updated",
        message: "Send DocuSign package updated.",
        metadata: {
          action: "priority_changed",
          fieldChanges: [
            { field: "priority", previousValue: "NORMAL", newValue: "HIGH" },
          ],
        },
      }),
    ).toMatchObject({
      actionText: "set priority to High",
      iconKey: "priority",
      tone: "amber",
    });
  });

  it("describes linked thread activity with a resource title", () => {
    expect(
      describeActivity({
        actorUserId: "user-eric",
        eventType: "linked_thread",
        metadata: { threadTitle: "Implementation thread" },
      }),
    ).toMatchObject({
      actionText: "linked Implementation thread",
      iconKey: "linked",
    });
  });

  it("describes OpenEngine agent activity with an agent actor", () => {
    expect(
      describeActivity({
        actorAgentId: "pi-agent",
        eventType: "agent_action",
        metadata: {
          source: "open_engine",
          receiptType: "done",
        },
      }),
    ).toMatchObject({
      actorLabel: "pi-agent",
      actionText: "completed OpenEngine work",
      iconKey: "agent",
    });
  });

  it("falls back without repeating the Work Item title", () => {
    expect(
      describeActivity({
        actorUserId: "user-eric",
        eventType: "updated",
        message: "Send DocuSign package updated.",
      }).actionText,
    ).toBe("updated this Work Item");
  });

  it("keeps unknown event types in card mode", () => {
    const unknown = event({ eventType: "custom_event" });

    expect(isWorkItemActivityTimelineEvent(unknown)).toBe(false);
    expect(
      describeWorkItemActivity({ event: unknown, item, assignees, statuses }),
    ).toMatchObject({
      displayMode: "card",
      iconKey: "updated",
      actionText: "Custom Event",
    });
  });
});
