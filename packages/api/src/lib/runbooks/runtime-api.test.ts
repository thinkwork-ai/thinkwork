import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectQueue: [] as Array<unknown[]>,
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("@thinkwork/database-pg", () => ({
  schema: { tenants: {} },
  getDb: () => ({
    select: () => {
      const rows = () => Promise.resolve(mocks.selectQueue.shift() ?? []);
      const chain = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: rows,
        then: (
          resolve: (value: unknown[] | undefined) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => rows().then(resolve, reject),
      };
      return chain;
    },
    update: () => ({
      set: (value: Record<string, unknown>) => {
        mocks.updates.push(value);
        const rows = () => Promise.resolve(mocks.selectQueue.shift() ?? []);
        return {
          where: () => ({
            returning: rows,
            then: (
              resolve: (value: unknown[] | undefined) => unknown,
              reject?: (reason: unknown) => unknown,
            ) => rows().then(resolve, reject),
          }),
        };
      },
    }),
    transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        select: () => {
          const rows = () => Promise.resolve(mocks.selectQueue.shift() ?? []);
          const chain = {
            from: () => chain,
            where: () => chain,
            orderBy: () => chain,
            limit: rows,
            then: (
              resolve: (value: unknown[] | undefined) => unknown,
              reject?: (reason: unknown) => unknown,
            ) => rows().then(resolve, reject),
          };
          return chain;
        },
        update: () => ({
          set: (value: Record<string, unknown>) => {
            mocks.updates.push(value);
            const rows = () => Promise.resolve(mocks.selectQueue.shift() ?? []);
            return {
              where: () => ({
                returning: rows,
                then: (
                  resolve: (value: unknown[] | undefined) => unknown,
                  reject?: (reason: unknown) => unknown,
                ) => rows().then(resolve, reject),
              }),
            };
          },
        }),
      }),
  }),
}));

import {
  completeRunbookExecutionRun,
  loadRunbookExecutionContext,
} from "./runtime-api.js";
import { failRunbookRunFromThreadTurn, markRunbookRunRunning } from "./runs.js";

const taskRow = {
  id: "task-1",
  task_type: "runbook_execute",
  input: {
    runbookRunId: "run-1",
    threadId: "thread-1",
    messageId: "message-1",
  },
};

const runRow = {
  id: "run-1",
  status: "running",
  invocation_mode: "auto",
  runbook_slug: "research-dashboard",
  runbook_version: "0.1.0",
  tenant_id: "tenant-1",
  computer_id: "computer-1",
  catalog_id: null,
  thread_id: "thread-1",
  selected_by_message_id: "message-1",
  approved_by_user_id: null,
  rejected_by_user_id: null,
  cancelled_by_user_id: null,
  definition_snapshot: { slug: "research-dashboard" },
  inputs: { prompt: "research" },
  output: null,
  error: null,
  idempotency_key: null,
  approved_at: null,
  rejected_at: null,
  cancelled_at: null,
  started_at: null,
  completed_at: null,
  created_at: new Date("2026-05-11T00:00:00.000Z"),
  updated_at: new Date("2026-05-11T00:00:00.000Z"),
};

const completedTask = {
  id: "rt-1",
  tenant_id: "tenant-1",
  run_id: "run-1",
  phase_id: "discover",
  phase_title: "Discover",
  task_key: "discover:1",
  title: "Discover evidence",
  summary: null,
  status: "completed",
  depends_on: [],
  capability_roles: ["research"],
  sort_order: 1,
  details: null,
  output: { evidence: ["a"] },
  error: null,
  started_at: null,
  completed_at: null,
  created_at: new Date("2026-05-11T00:00:00.000Z"),
  updated_at: new Date("2026-05-11T00:00:00.000Z"),
};

describe("runbook runtime API helpers", () => {
  beforeEach(() => {
    mocks.selectQueue = [];
    mocks.updates = [];
  });

  it("loads runbook execution context with completed task outputs", async () => {
    mocks.selectQueue.push(
      [taskRow],
      [runRow],
      [completedTask],
      [
        {
          id: "computer-1",
          name: "Marco",
          slug: "marco",
          workspace_root: "/workspace",
        },
      ],
      [{ id: "thread-1", title: "Research" }],
      [{ id: "message-1", content: "Build a dashboard" }],
    );

    const result = await loadRunbookExecutionContext({
      tenantId: "tenant-1",
      computerId: "computer-1",
      taskId: "task-1",
    });

    expect(result).toMatchObject({
      taskId: "task-1",
      run: {
        id: "run-1",
        status: "running",
        runbookSlug: "research-dashboard",
      },
      previousOutputs: {
        "discover:1": { evidence: ["a"] },
      },
    });
  });

  it("refuses to complete a run while tasks are still incomplete", async () => {
    mocks.selectQueue.push(
      [taskRow],
      [runRow],
      [{ ...completedTask, status: "pending" }],
    );

    await expect(
      completeRunbookExecutionRun({
        tenantId: "tenant-1",
        computerId: "computer-1",
        taskId: "task-1",
        output: { done: true },
      }),
    ).rejects.toThrow("Cannot complete runbook run with incomplete tasks");
    expect(mocks.updates).toHaveLength(0);
  });

  it("marks the run and first pending task running without marking every task running", async () => {
    const firstTask = {
      ...completedTask,
      status: "pending",
      output: null,
    };
    const pendingTask = {
      ...completedTask,
      id: "rt-2",
      task_key: "discover:2",
      title: "Inventory evidence",
      status: "pending",
      sort_order: 2,
      output: null,
    };
    mocks.selectQueue.push(
      [],
      [],
      [{ id: "rt-1" }],
      [],
      [{ ...runRow, status: "running" }],
      [{ ...firstTask, status: "running" }, pendingTask],
    );

    const result = await markRunbookRunRunning({
      tenantId: "tenant-1",
      runId: "run-1",
    });

    expect(mocks.updates).toHaveLength(2);
    expect(mocks.updates[0]).toMatchObject({ status: "running" });
    expect(mocks.updates[1]).toMatchObject({ status: "running" });
    expect(result?.tasks.map((task) => task.status)).toEqual([
      "RUNNING",
      "PENDING",
    ]);
  });

  it("fails only the active task and skips pending tasks when a thread-turn runbook fails", async () => {
    const runningTask = {
      ...completedTask,
      status: "running",
      output: null,
    };
    const pendingTask = {
      ...completedTask,
      id: "rt-2",
      task_key: "discover:2",
      title: "Inventory evidence",
      status: "pending",
      sort_order: 2,
      output: null,
    };
    mocks.selectQueue.push(
      [{ id: "rt-1" }],
      [],
      [],
      [],
      [{ ...runRow, status: "failed" }],
      [
        { ...runningTask, status: "failed" },
        { ...pendingTask, status: "skipped" },
      ],
    );

    const result = await failRunbookRunFromThreadTurn({
      tenantId: "tenant-1",
      runId: "run-1",
      error: { message: "boom" },
    });

    expect(mocks.updates).toHaveLength(3);
    expect(mocks.updates[0]).toMatchObject({
      status: "failed",
      error: { message: "boom" },
    });
    expect(mocks.updates[1]).toMatchObject({ status: "skipped" });
    expect(mocks.updates[2]).toMatchObject({
      status: "failed",
      error: { message: "boom" },
    });
    expect(result?.tasks.map((task) => task.status)).toEqual([
      "FAILED",
      "SKIPPED",
    ]);
  });
});
