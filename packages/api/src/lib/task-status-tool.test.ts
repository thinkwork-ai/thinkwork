import { describe, expect, it, vi } from "vitest";
import { setTaskStatus, TaskStatusToolError } from "./task-status-tool";

function fakeDb(options: { taskStatus?: string; requiredComplete?: boolean }) {
  const updates: Record<string, unknown>[] = [];
  const inserts: Record<string, unknown>[] = [];
  const selectRows: unknown[][] = [
    [
      {
        id: "task-1",
        tenantId: "tenant-1",
        spaceId: "space-1",
        threadId: "thread-1",
        provider: "thinkwork",
        title: "Collect invoice",
        status: options.taskStatus ?? "todo",
        metadata: {},
        threadAgentId: "agent-1",
      },
    ],
    [
      {
        id: "goal-1",
        status: "active",
        metadata: {},
      },
    ],
    [
      {
        status: options.requiredComplete === false ? "todo" : "completed",
        required: true,
      },
    ],
  ];
  const updateRows: unknown[][] = [[{ id: "task-1" }], [{ id: "goal-1" }]];
  const tx = {
    select: vi.fn(() => {
      const rows = selectRows.shift() ?? [];
      const chain = {
        from: () => chain,
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
            returning: async () => updateRows.shift() ?? [],
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

describe("setTaskStatus", () => {
  it("updates a linked task in a transaction and advances an active goal to review", async () => {
    const store = fakeDb({});
    const refreshGoalFolder = vi.fn(async () => []);

    await expect(
      setTaskStatus(
        {
          tenantId: "tenant-1",
          threadId: "thread-1",
          agentId: "agent-1",
          linkedTaskId: "task-1",
          status: "completed",
          note: "Invoice received",
          actor: { type: "agent", id: "agent-1" },
        },
        {
          db: store.db as never,
          now: () => new Date("2026-05-31T12:00:00.000Z"),
          refreshGoalFolder,
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      linkedTaskId: "task-1",
      previousStatus: "todo",
      status: "completed",
      goalStatus: "in_review",
    });

    expect(store.updates[0]).toMatchObject({
      status: "completed",
      blocked: false,
      sync_status: "synced",
    });
    expect(store.inserts[0]).toMatchObject({
      tenant_id: "tenant-1",
      linked_task_id: "task-1",
      event_type: "completed",
      previous_status: "todo",
      new_status: "completed",
    });
    expect(store.updates[1]).toMatchObject({ status: "in_review" });
    expect(refreshGoalFolder).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      threadId: "thread-1",
    });
  });

  it("rejects status changes away from terminal task states", async () => {
    const store = fakeDb({ taskStatus: "completed" });

    await expect(
      setTaskStatus(
        {
          tenantId: "tenant-1",
          threadId: "thread-1",
          agentId: "agent-1",
          linkedTaskId: "task-1",
          status: "blocked",
          actor: { type: "agent", id: "agent-1" },
        },
        { db: store.db as never },
      ),
    ).rejects.toMatchObject({
      code: "INVALID_STATUS_TRANSITION",
      statusCode: 409,
    } satisfies Partial<TaskStatusToolError>);

    expect(store.updates).toEqual([]);
    expect(store.inserts).toEqual([]);
  });
});
