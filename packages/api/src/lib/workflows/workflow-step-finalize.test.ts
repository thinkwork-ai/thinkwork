/**
 * Unit tests for the workflow-interpreter finalize hook (THINK-219 U6).
 *
 * Fake-db style (mirrors workflow-step-dispatch.test.ts): the real
 * @thinkwork/database-pg adapters (consumeTaskToken, recordWorkflowStepEvent)
 * run against an in-memory fake; only the SFN client is mocked. The token
 * consume result is controlled via `updateQueue` — the first update() a
 * finalize issues is consumeTaskToken's CAS.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSfnSend } = vi.hoisted(() => ({ mockSfnSend: vi.fn() }));

vi.mock("@aws-sdk/client-sfn", () => ({
  SFNClient: class {
    send = mockSfnSend;
  },
  SendTaskSuccessCommand: class {
    constructor(public input: unknown) {}
    static name = "SendTaskSuccessCommand";
  },
  SendTaskFailureCommand: class {
    constructor(public input: unknown) {}
    static name = "SendTaskFailureCommand";
  },
}));

import type { FinalizeGoalRunProjection } from "../chat-finalize/types.js";
import { projectWorkflowStepFinalize } from "./workflow-step-finalize.js";

type Rows = Record<string, unknown>[];

interface FakeDb {
  db: unknown;
  updateQueue: Rows[];
  inserts: Record<string, unknown>[];
  updates: Record<string, unknown>[];
}

function makeDb(): FakeDb {
  const updateQueue: Rows[] = [];
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];

  const db = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve([] as Rows) }),
      }),
    }),
    insert: () => ({
      values: (value: Record<string, unknown>) => {
        inserts.push(value);
        return Object.assign(Promise.resolve([] as Rows), {
          returning: () => Promise.resolve([] as Rows),
        });
      },
    }),
    update: () => ({
      set: (value: Record<string, unknown>) => {
        updates.push(value);
        const rows = updateQueue.shift() ?? [];
        return {
          where: () =>
            Object.assign(Promise.resolve(rows), {
              returning: () => Promise.resolve(rows),
            }),
        };
      },
    }),
  };

  return { db, updateQueue, inserts, updates };
}

const CTX = { workflowRun: { runId: "run-1", stepId: "draft", iteration: 2 } };

function goalRun(
  overrides: Partial<FinalizeGoalRunProjection> = {},
): FinalizeGoalRunProjection {
  return {
    source: "pi_goal",
    status: "completed",
    resume_eligible: false,
    ...overrides,
  };
}

let fake: FakeDb;
beforeEach(() => {
  fake = makeDb();
  mockSfnSend.mockReset();
  mockSfnSend.mockResolvedValue({});
});

describe("projectWorkflowStepFinalize — skip / hold", () => {
  it("skips a turn with no workflowRun context (not a workflow step)", async () => {
    const result = await projectWorkflowStepFinalize(
      {
        tenantId: "t1",
        threadTurnId: "turn-1",
        contextSnapshot: { agentLoop: { runId: "x", iterationId: "y" } },
        goalRun: goalRun(),
        responseText: "ok",
        turnStatus: "completed",
      },
      { db: fake.db as never },
    );
    expect(result).toEqual({
      status: "skipped",
      reason: "not_workflow_step_turn",
    });
    expect(mockSfnSend).not.toHaveBeenCalled();
    expect(fake.updates).toHaveLength(0);
    expect(fake.inserts).toHaveLength(0);
  });

  it("holds a non-terminal turn (still running) — no consume, no event, no SFN", async () => {
    const result = await projectWorkflowStepFinalize(
      {
        tenantId: "t1",
        threadTurnId: "turn-1",
        contextSnapshot: CTX,
        goalRun: goalRun({ status: "active" }),
        responseText: "working",
        turnStatus: "running",
      },
      { db: fake.db as never },
    );
    expect(result).toEqual({ status: "held", reason: "turn_not_terminal" });
    expect(mockSfnSend).not.toHaveBeenCalled();
    expect(fake.updates).toHaveLength(0);
    expect(fake.inserts).toHaveLength(0);
  });
});

describe("projectWorkflowStepFinalize — completed", () => {
  it("appends workflow_step_finished + resumes the token exactly once", async () => {
    fake.updateQueue.push([{ token: "task-token-1" }]); // consume wins
    const result = await projectWorkflowStepFinalize(
      {
        tenantId: "t1",
        threadTurnId: "turn-1",
        contextSnapshot: CTX,
        goalRun: goalRun({
          status: "completed",
          completion_summary: "report shipped",
          tokens_used: 4200,
        }),
        responseText: "done",
        turnStatus: "completed",
      },
      { db: fake.db as never },
    );

    expect(result).toMatchObject({
      status: "resumed",
      turnStatus: "completed",
    });
    expect(mockSfnSend).toHaveBeenCalledTimes(1);

    const command = mockSfnSend.mock.calls[0][0] as {
      constructor: { name: string };
      input: { taskToken: string; output: string };
    };
    expect(command.constructor.name).toBe("SendTaskSuccessCommand");
    expect(command.input.taskToken).toBe("task-token-1");
    const output = JSON.parse(command.input.output);
    expect(output.turnStatus).toBe("completed");
    expect(output.evidence).toMatchObject({
      status: "completed",
      completionSummary: "report shipped",
      tokensUsed: 4200,
      needsHuman: null,
    });

    // Exactly one workflow_step_finished event appended.
    const events = fake.inserts.filter(
      (i) => i.event_type === "workflow_step_finished",
    );
    expect(events).toHaveLength(1);
  });

  it("is a no-op on a double finalize after the token was already consumed", async () => {
    fake.updateQueue.push([]); // consume returns null (already consumed)
    const result = await projectWorkflowStepFinalize(
      {
        tenantId: "t1",
        threadTurnId: "turn-1",
        contextSnapshot: CTX,
        goalRun: goalRun(),
        responseText: "done",
        turnStatus: "completed",
      },
      { db: fake.db as never },
    );
    expect(result).toMatchObject({ status: "already_consumed" });
    expect(mockSfnSend).not.toHaveBeenCalled();
    // No duplicate event inserted.
    expect(fake.inserts).toHaveLength(0);
  });

  it("maps a paused goal to evidence.needsHuman=true in the SendTaskSuccess output", async () => {
    fake.updateQueue.push([{ token: "task-token-2" }]);
    await projectWorkflowStepFinalize(
      {
        tenantId: "t1",
        threadTurnId: "turn-1",
        contextSnapshot: CTX,
        goalRun: goalRun({ status: "paused", resume_eligible: true }),
        responseText: "need a human",
        turnStatus: "completed",
      },
      { db: fake.db as never },
    );
    const command = mockSfnSend.mock.calls[0][0] as {
      input: { output: string };
    };
    const output = JSON.parse(command.input.output);
    expect(output.turnStatus).toBe("completed");
    expect(output.evidence.status).toBe("paused");
    expect(output.evidence.needsHuman).toBe(true);
  });
});

describe("projectWorkflowStepFinalize — failed", () => {
  it("appends workflow_step_failed + SendTaskFailure with a bounded cause", async () => {
    fake.updateQueue.push([{ token: "task-token-3" }]);
    const result = await projectWorkflowStepFinalize(
      {
        tenantId: "t1",
        threadTurnId: "turn-1",
        contextSnapshot: CTX,
        goalRun: null,
        responseText: "",
        turnStatus: "failed",
        errorMessage: "the worker exploded",
      },
      { db: fake.db as never },
    );

    expect(result).toMatchObject({ status: "resumed", turnStatus: "failed" });
    expect(mockSfnSend).toHaveBeenCalledTimes(1);
    const command = mockSfnSend.mock.calls[0][0] as {
      constructor: { name: string };
      input: { taskToken: string; error: string; cause: string };
    };
    expect(command.constructor.name).toBe("SendTaskFailureCommand");
    expect(command.input.taskToken).toBe("task-token-3");
    expect(command.input.error).toBe("WorkflowStepFailed");
    expect(command.input.cause).toBe("the worker exploded");

    const events = fake.inserts.filter(
      (i) => i.event_type === "workflow_step_failed",
    );
    expect(events).toHaveLength(1);
  });
});
