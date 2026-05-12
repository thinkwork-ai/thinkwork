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
  runbookProgressContent,
  shouldIncludeRunbookHistoryMessage,
  unsupportedCapabilityError,
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

  it("formats completed runbook progress without dumping raw task markdown", () => {
    const content = runbookProgressContent({
      kind: "completed",
      task: {
        ...completedTask,
        title: "Identify CRM entities, fields, and data freshness.",
      } as never,
      nextTask: {
        ...completedTask,
        id: "rt-2",
        task_key: "discover:2",
        title: "Inventory account and opportunity fields.",
        sort_order: 2,
      } as never,
      output: {
        responseText:
          "Solid. Here's the complete discovery output for task `discover:1`: --- ## Task Output — `discover:1`: CRM Entity & Field Inventory ### Pipeline - Single pipeline: `Opportunities` | Field | Coverage | Notes |",
      },
    });

    expect(content).toContain(
      "**Completed:** Identify CRM entities, fields, and data freshness.",
    );
    expect(content).toContain("**Summary:**");
    expect(content).toContain("CRM Entity & Field Inventory");
    expect(content).toContain(
      "**Next:** Inventory account and opportunity fields.",
    );
    expect(content).not.toContain("```");
    expect(content).not.toContain("discover:1");
    expect(content).not.toContain("`discover:1`");
    expect(content).not.toContain("| Field |");
  });

  it("excludes runbook chrome messages from AgentCore step history", () => {
    expect(
      shouldIncludeRunbookHistoryMessage({
        runbookMessageKey: "runbook-progress:run-1:discover:1:completed",
      }),
    ).toBe(false);
    expect(
      shouldIncludeRunbookHistoryMessage({
        runbookMessageKey: "runbook-queue:run-1",
      }),
    ).toBe(false);
    expect(
      shouldIncludeRunbookHistoryMessage({
        runbookMessageKey: "runbook-confirmation:run-1",
      }),
    ).toBe(false);
    expect(
      shouldIncludeRunbookHistoryMessage({
        runbookMessageKey: "runbook-response:run-1",
      }),
    ).toBe(true);
    expect(shouldIncludeRunbookHistoryMessage({})).toBe(true);
  });

  it("rejects unsupported capability roles before AgentCore dispatch", () => {
    expect(
      unsupportedCapabilityError({
        id: "rt-1",
        taskKey: "discover:1",
        capabilityRoles: ["research", "warehouse_magic"],
      }),
    ).toMatchObject({
      code: "UNSUPPORTED_RUNBOOK_CAPABILITY",
      taskId: "rt-1",
      taskKey: "discover:1",
      capabilityRoles: ["warehouse_magic"],
    });
    expect(
      unsupportedCapabilityError({
        id: "rt-1",
        taskKey: "discover:1",
        capabilityRoles: ["experimental:tenant-tool"],
      }),
    ).toBeNull();
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
