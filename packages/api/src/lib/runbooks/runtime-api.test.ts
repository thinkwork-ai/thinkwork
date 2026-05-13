import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectQueue: [] as Array<unknown[]>,
  updates: [] as Array<Record<string, unknown>>,
  costRecords: [] as Array<Record<string, unknown>>,
  budgetChecks: [] as Array<[string, string]>,
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

vi.mock("../cost-recording.js", () => ({
  extractUsage: (invokeResult: Record<string, unknown>) => {
    const response = (invokeResult.response || {}) as Record<string, unknown>;
    const usage = (invokeResult.usage || response.usage || {}) as Record<
      string,
      number
    >;
    return {
      inputTokens:
        usage.inputTokens || usage.input_tokens || usage.prompt_tokens || 0,
      outputTokens:
        usage.outputTokens || usage.output_tokens || usage.completion_tokens || 0,
      cachedReadTokens:
        usage.cacheReadInputTokens ||
        usage.cachedReadTokens ||
        usage.cached_read_tokens ||
        usage.cache_read_input_tokens ||
        0,
      model:
        (invokeResult.model as string) || (response.model as string) || null,
    };
  },
  recordCostEvents: vi.fn(async (params: Record<string, unknown>) => {
    mocks.costRecords.push(params);
    return { totalUsd: 0.123456, llmUsd: 0.1, computeUsd: 0.023456 };
  }),
  checkBudgetAndPause: vi.fn(async (tenantId: string, agentId: string) => {
    mocks.budgetChecks.push([tenantId, agentId]);
  }),
}));

import {
  compactRunbookPreviousOutputs,
  completeRunbookExecutionTask,
  completeRunbookExecutionRun,
  loadRunbookExecutionContext,
  resolveRunbookStepModel,
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
    mocks.costRecords = [];
    mocks.budgetChecks = [];
    delete process.env.RUNBOOK_FAST_STEP_MODEL;
    delete process.env.RUNBOOK_ARTIFACT_STEP_MODEL;
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

  it("compacts prior runbook outputs before handing them to later steps", () => {
    const compacted = compactRunbookPreviousOutputs({
      "discover:1": {
        ok: true,
        responseText: "x".repeat(3_000),
        toolInvocations: [{ name: "web_search", args: { q: "crm" } }],
        usage: { input_tokens: 100 },
      },
    });

    expect(compacted["discover:1"]).toMatchObject({
      ok: true,
      usage: { input_tokens: 100 },
    });
    expect(JSON.stringify(compacted)).not.toContain("web_search");
    expect(
      String((compacted["discover:1"] as { responseText: string }).responseText)
        .length,
    ).toBeLessThan(1_600);
  });

  it("records tokens, dollars, duration, and output for completed runbook subagent steps", async () => {
    const runningTask = {
      ...completedTask,
      status: "running",
      started_at: new Date("2026-05-11T00:00:00.000Z"),
      completed_at: null,
      output: null,
      capability_roles: ["research"],
    };
    const output = {
      ok: true,
      responseText: "Fetched pipeline fields and wrote concise evidence.",
      model: "us.anthropic.claude-sonnet-4-6",
      durationMs: 145_200,
      usage: {
        input_tokens: 577,
        output_tokens: 11150,
        cached_read_tokens: 12,
      },
    };

    mocks.selectQueue.push(
      [taskRow],
      [runRow],
      [runningTask],
      [
        {
          primary_agent_id: "agent-primary",
          migrated_from_agent_id: "agent-legacy",
        },
      ],
      [{ ...runningTask, status: "completed", output: null }],
      [runRow],
      [{ ...runningTask, status: "completed" }],
      [],
      [runRow],
      [{ ...runningTask, status: "completed" }],
      [{ id: "message-existing" }],
    );

    await completeRunbookExecutionTask({
      tenantId: "tenant-1",
      computerId: "computer-1",
      taskId: "task-1",
      runbookTaskId: "rt-1",
      output,
    });

    expect(mocks.costRecords).toHaveLength(1);
    expect(mocks.costRecords[0]).toMatchObject({
      tenantId: "tenant-1",
      agentId: "agent-primary",
      requestId: "runbook:run-1:rt-1",
      traceId: "runbook:run-1:discover:1",
      threadId: "thread-1",
      source: "computer_runbook_step",
      model: "us.anthropic.claude-sonnet-4-6",
      inputTokens: 577,
      outputTokens: 11150,
      cachedReadTokens: 12,
      durationMs: 145_200,
    });
    expect(mocks.budgetChecks).toEqual([["tenant-1", "agent-primary"]]);
    expect(mocks.updates[0]).toMatchObject({
      status: "completed",
      output: {
        ok: true,
        responseText: "Fetched pipeline fields and wrote concise evidence.",
        usage: {
          input_tokens: 577,
          output_tokens: 11150,
          cached_read_tokens: 12,
        },
        cost: {
          requestId: "runbook:run-1:rt-1",
          traceId: "runbook:run-1:discover:1",
          estimatedCostUsd: 0.123456,
          llmCostUsd: 0.1,
          computeCostUsd: 0.023456,
        },
      },
    });
  });

  it("routes runbook step models by capability role using approved defaults", () => {
    expect(
      resolveRunbookStepModel({
        templateModel: "us.anthropic.claude-sonnet-4-6",
        capabilityRoles: ["research"],
      }),
    ).toBe("moonshotai.kimi-k2.5");
    expect(
      resolveRunbookStepModel({
        templateModel: "us.anthropic.claude-sonnet-4-6",
        capabilityRoles: ["artifact_build"],
      }),
    ).toBe("us.anthropic.claude-sonnet-4-6");
  });

  it("allows emergency runbook step model overrides from env", () => {
    process.env.RUNBOOK_FAST_STEP_MODEL = "fallback-fast-model";
    process.env.RUNBOOK_ARTIFACT_STEP_MODEL = "fallback-artifact-model";

    expect(
      resolveRunbookStepModel({
        templateModel: "us.anthropic.claude-sonnet-4-6",
        capabilityRoles: ["research"],
      }),
    ).toBe("fallback-fast-model");
    expect(
      resolveRunbookStepModel({
        templateModel: "us.anthropic.claude-sonnet-4-6",
        capabilityRoles: ["artifact_build"],
      }),
    ).toBe("fallback-artifact-model");
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
