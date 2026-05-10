import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectQueue: [] as Array<unknown[]>,
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("@thinkwork/database-pg", () => ({
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
  runbook_slug: "research-dashboard",
  runbook_version: "0.1.0",
  tenant_id: "tenant-1",
  computer_id: "computer-1",
  thread_id: "thread-1",
  selected_by_message_id: "message-1",
  definition_snapshot: { slug: "research-dashboard" },
  inputs: { prompt: "research" },
};

const completedTask = {
  id: "rt-1",
  phase_id: "discover",
  phase_title: "Discover",
  task_key: "discover:1",
  title: "Discover evidence",
  summary: null,
  status: "completed",
  depends_on: [],
  capability_roles: ["research"],
  sort_order: 1,
  output: { evidence: ["a"] },
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
});
