import { describe, expect, it, vi } from "vitest";
import { TaskStatusToolError } from "../task-status-tool";
import { setWorkItemStatus } from "./work-item-status-tool";

function statusRow(
  overrides: Partial<{
    id: string;
    name: string;
    category: string;
  }> = {},
) {
  const category = overrides.category ?? "done";
  return {
    id: overrides.id ?? "status-done",
    tenant_id: "tenant-1",
    space_id: "space-1",
    name: overrides.name ?? "Done",
    description: null,
    color: null,
    icon: null,
    category,
    is_active: true,
    is_final: category === "done" || category === "skipped",
    is_default: false,
    display_order: 30,
    created_at: new Date("2026-06-24T18:00:00.000Z"),
    updated_at: new Date("2026-06-24T18:00:00.000Z"),
  };
}

function fakeDb(options: {
  currentStatusCategory?: string;
  threadAgentId?: string | null;
  threadLinked?: boolean;
}) {
  const updates: Record<string, unknown>[] = [];
  const inserts: Record<string, unknown>[] = [];
  const selectRows: unknown[][] = [
    [
      {
        id: "work-item-1",
        tenantId: "tenant-1",
        spaceId: "space-1",
        title: "Collect invoice",
        statusId: "status-todo",
        metadata: { linkedTaskId: "task-1" },
        currentStatusCategory: options.currentStatusCategory ?? "todo",
      },
    ],
    options.threadLinked === false
      ? []
      : [
          {
            threadId: "thread-1",
            agentId: options.threadAgentId ?? "agent-1",
          },
        ],
  ];
  const tx = {
    select: vi.fn(() => {
      const rows = selectRows.shift() ?? [];
      const chain = {
        from: () => chain,
        leftJoin: () => chain,
        innerJoin: () => chain,
        where: () => chain,
        limit: async () => rows,
        then: (
          resolve: (value: unknown[]) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => Promise.resolve(rows).then(resolve, reject),
      };
      return chain;
    }),
    update: vi.fn(() => ({
      set(value: Record<string, unknown>) {
        updates.push(value);
        return {
          where: () => ({
            returning: async () => [{ id: "work-item-1" }],
          }),
        };
      },
    })),
    insert: vi.fn(() => ({
      values(value: Record<string, unknown>) {
        inserts.push(value);
        return Promise.resolve();
      },
    })),
  };

  return {
    updates,
    inserts,
    db: {
      transaction: (fn: (inner: typeof tx) => unknown) => fn(tx),
    },
  };
}

describe("setWorkItemStatus", () => {
  it("updates a native work item, records provenance, and syncs linked-task compatibility", async () => {
    const store = fakeDb({});
    const syncLinkedTask = vi.fn(async () => ({
      linkedTaskId: "task-1",
      previousStatus: "todo",
      status: "completed",
    }));

    await expect(
      setWorkItemStatus(
        {
          tenantId: "tenant-1",
          threadId: "thread-1",
          agentId: "agent-1",
          workItemId: "work-item-1",
          statusCategory: "done",
          note: "Invoice received",
          metadata: { sourceMessageId: "msg-1" },
          threadTurnId: "turn-1",
          toolCallId: "call-1",
          actor: { type: "agent", id: "agent-1" },
        },
        {
          db: store.db as never,
          now: () => new Date("2026-06-24T19:00:00.000Z"),
          findStatusForUpdate: async () => statusRow(),
          syncLinkedTask,
          refreshGoalFolder: async () => [],
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      workItemId: "work-item-1",
      previousStatusCategory: "todo",
      statusCategory: "done",
      statusId: "status-done",
      linkedTaskId: "task-1",
    });

    expect(store.updates[0]).toMatchObject({
      status_id: "status-done",
      blocked: false,
      completed_by_agent_id: "agent-1",
    });
    expect(store.inserts[0]).toMatchObject({
      tenant_id: "tenant-1",
      work_item_id: "work-item-1",
      actor_agent_id: "agent-1",
      event_type: "completed",
      previous_status_id: "status-todo",
      new_status_id: "status-done",
    });
    expect(store.inserts[0]?.metadata).toMatchObject({
      source: "set_work_item_status",
      threadTurnId: "turn-1",
      toolCallId: "call-1",
    });
    expect(syncLinkedTask).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        workItemId: "work-item-1",
        statusCategory: "done",
        threadId: "thread-1",
        actor: { type: "agent", id: "agent-1" },
      }),
      expect.objectContaining({ database: expect.any(Object) }),
    );
  });

  it("rejects agent updates when the work item is not linked to the invocation thread", async () => {
    const store = fakeDb({ threadLinked: false });

    await expect(
      setWorkItemStatus(
        {
          tenantId: "tenant-1",
          threadId: "thread-1",
          agentId: "agent-1",
          workItemId: "work-item-1",
          statusCategory: "done",
          actor: { type: "agent", id: "agent-1" },
        },
        {
          db: store.db as never,
          findStatusForUpdate: async () => statusRow(),
          syncLinkedTask: async () => null,
          refreshGoalFolder: async () => [],
        },
      ),
    ).rejects.toMatchObject({
      code: "WORK_ITEM_THREAD_REQUIRED",
      statusCode: 403,
    } satisfies Partial<TaskStatusToolError>);

    expect(store.updates).toEqual([]);
    expect(store.inserts).toEqual([]);
  });
});
