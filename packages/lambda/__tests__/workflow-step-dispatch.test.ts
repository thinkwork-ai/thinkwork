/**
 * Unit tests for the workflow interpreter step-dispatch Lambda (THINK-219 U5).
 *
 * Fake-db style: the exported phase functions take a db handle, so tests pass
 * an in-memory fake and assert on the captured inserts/updates. The real
 * @thinkwork/database-pg adapters (storeTaskToken, recordWorkflowStepEvent, …)
 * run against the fake db — only getDb() is avoided (it lives in `handler`).
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  ROLLOVER_CYCLE_THRESHOLD,
  MAX_ROLLOVERS,
  type InterpreterCursor,
  type WorkflowDefinition,
} from "@thinkwork/agent-loops-core";

import {
  handleDispatchAgent,
  handleExecuteStep,
  handleLoadNext,
  handleRecordAdvance,
  handleRecordApproval,
  type StepExecutors,
} from "../workflow-step-dispatch";

type Rows = Record<string, unknown>[];

interface FakeDb {
  db: unknown;
  selectQueue: Rows[];
  updateQueue: Rows[];
  inserts: Record<string, unknown>[];
  updates: Record<string, unknown>[];
}

function makeDb(): FakeDb {
  const selectQueue: Rows[] = [];
  const updateQueue: Rows[] = [];
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];

  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(selectQueue.shift() ?? []),
          orderBy: () => Promise.resolve(selectQueue.shift() ?? []),
        }),
      }),
    }),
    insert: () => ({
      values: (value: Record<string, unknown>) => {
        inserts.push(value);
        const rows = Promise.resolve([] as Rows);
        return Object.assign(rows, {
          returning: () => Promise.resolve([] as Rows),
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve([] as Rows),
          }),
          onConflictDoUpdate: () => Promise.resolve([] as Rows),
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

  return { db, selectQueue, updateQueue, inserts, updates };
}

const NOW = new Date("2026-07-07T12:00:00.000Z");

function cursor(overrides: Partial<InterpreterCursor> = {}): InterpreterCursor {
  return {
    workflowRunId: "run-1",
    tenantId: "t1",
    stepPointer: 0,
    iteration: 1,
    loopCycleCount: 0,
    rolloverCount: 0,
    ...overrides,
  };
}

const AGENT_ONLY_LOOP: WorkflowDefinition = {
  version: 1,
  steps: [{ id: "draft", kind: "agent", objective: "Draft the report" }],
  continuationPolicy: {
    exitSignal: "the report exists and is shared",
    maxIterations: 5,
  },
};

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    tenant_id: "t1",
    status: "running",
    backend_execution_id: "arn:exec",
    workflow_version_id: "v1",
    input_summary: { agentId: "a1", workflowName: "WF", spaceId: "sp1" },
    ...overrides,
  };
}

function versionRow(definition: WorkflowDefinition = AGENT_ONLY_LOOP) {
  return { definition_snapshot: definition };
}

let fake: FakeDb;
beforeEach(() => {
  fake = makeDb();
});

// ---------------------------------------------------------------------------
// AE1 — exit signal / budget
// ---------------------------------------------------------------------------

describe("record_advance — continuation policy (AE1)", () => {
  it("exit signal satisfied at iteration 3 → terminal_success, no iteration-4 dispatch", async () => {
    fake.selectQueue.push([runRow()], [versionRow()], []); // run, version, no prior decision
    const result = await handleRecordAdvance(
      fake.db as never,
      {
        phase: "record_advance",
        cursor: cursor({ iteration: 3 }),
        stepResult: {
          turnStatus: "completed",
          evidence: { status: "completed" },
        },
      },
      NOW,
    );
    expect(result.directive).toBe("terminal_success");
    // No wakeup / dispatch happens on this phase.
    expect(fake.inserts.some((i) => i.source === "workflow_step")).toBe(false);
    // Policy decision recorded with runStatus succeeded.
    expect(fake.updates.some((u) => u.status === "succeeded")).toBe(true);
  });

  it("iteration 5 of maxIterations 5 with unmet goal → terminal_failure (max_iterations_reached)", async () => {
    fake.selectQueue.push([runRow()], [versionRow()], []);
    const result = await handleRecordAdvance(
      fake.db as never,
      {
        phase: "record_advance",
        cursor: cursor({ iteration: 5 }),
        stepResult: {
          turnStatus: "completed",
          evidence: { status: "working" },
        },
      },
      NOW,
    );
    expect(result.directive).toBe("terminal_failure");
    const decision = fake.inserts.find(
      (i) => i.event_type === "workflow_policy_decision",
    );
    expect(decision).toBeTruthy();
    expect((decision?.payload_summary as Record<string, unknown>).reason).toBe(
      "max_iterations_reached",
    );
    expect(fake.updates.some((u) => u.status === "failed")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AE2 — failed turn
// ---------------------------------------------------------------------------

describe("record_advance — failed turn (AE2)", () => {
  it("turnStatus failed → workflow_step_failed with errorSummary + terminal_failure", async () => {
    fake.selectQueue.push([runRow()], [versionRow()], []);
    const result = await handleRecordAdvance(
      fake.db as never,
      {
        phase: "record_advance",
        cursor: cursor({ iteration: 2 }),
        stepResult: { turnStatus: "failed", errorSummary: "the agent crashed" },
      },
      NOW,
    );
    expect(result.directive).toBe("terminal_failure");
    const failed = fake.inserts.find(
      (i) => i.event_type === "workflow_step_failed",
    );
    expect(failed).toBeTruthy();
    expect(
      (failed?.payload_summary as Record<string, unknown>).errorSummary,
    ).toBe("the agent crashed");
  });

  it("absent stepResult on an agent step is treated as a failed turn", async () => {
    fake.selectQueue.push([runRow()], [versionRow()], []);
    const result = await handleRecordAdvance(
      fake.db as never,
      { phase: "record_advance", cursor: cursor({ iteration: 2 }) },
      NOW,
    );
    expect(result.directive).toBe("terminal_failure");
    const failed = fake.inserts.find(
      (i) => i.event_type === "workflow_step_failed",
    );
    expect(
      (failed?.payload_summary as Record<string, unknown>).errorSummary,
    ).toBe("agent step did not return a result");
  });
});

// ---------------------------------------------------------------------------
// Idempotent retry
// ---------------------------------------------------------------------------

describe("record_advance — idempotent retry", () => {
  it("existing policy-decision event → no duplicate inserts, same directive", async () => {
    // run, version, prior decision row present.
    fake.selectQueue.push([runRow()], [versionRow()], [{ id: 99 }]);
    const result = await handleRecordAdvance(
      fake.db as never,
      {
        phase: "record_advance",
        cursor: cursor({ iteration: 3 }),
        stepResult: {
          turnStatus: "completed",
          evidence: { status: "completed" },
        },
      },
      NOW,
    );
    expect(result.directive).toBe("terminal_success");
    expect(fake.inserts).toHaveLength(0);
    expect(fake.updates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Rollover
// ---------------------------------------------------------------------------

describe("record_advance — rollover", () => {
  it("emits rollover past the cycle threshold via the continue path", async () => {
    fake.selectQueue.push([runRow()], [versionRow()], []);
    const result = await handleRecordAdvance(
      fake.db as never,
      {
        phase: "record_advance",
        cursor: cursor({
          iteration: 2,
          loopCycleCount: ROLLOVER_CYCLE_THRESHOLD,
        }),
        stepResult: {
          turnStatus: "completed",
          evidence: { status: "working" },
        },
      },
      NOW,
    );
    expect(result.directive).toBe("rollover");
    expect(result.cursor.rolloverCount).toBe(1);
    expect(result.cursor.loopCycleCount).toBe(0);
    expect(result.cursor.iteration).toBe(3);
  });

  it("blocked at MAX_ROLLOVERS → terminal_failure (max_rollovers_guard)", async () => {
    fake.selectQueue.push([runRow()], [versionRow()], []);
    const result = await handleRecordAdvance(
      fake.db as never,
      {
        phase: "record_advance",
        cursor: cursor({
          iteration: 2,
          loopCycleCount: ROLLOVER_CYCLE_THRESHOLD,
          rolloverCount: MAX_ROLLOVERS,
        }),
        stepResult: {
          turnStatus: "completed",
          evidence: { status: "working" },
        },
      },
      NOW,
    );
    expect(result.directive).toBe("terminal_failure");
    const guard = fake.inserts.find(
      (i) =>
        i.event_type === "workflow_step_failed" &&
        (i.payload_summary as Record<string, unknown>).reason ===
          "max_rollovers_guard",
    );
    expect(guard).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// load_next
// ---------------------------------------------------------------------------

describe("load_next", () => {
  it("throws on a tenant mismatch (KTD9)", async () => {
    fake.selectQueue.push([runRow({ tenant_id: "other-tenant" })]);
    await expect(
      handleLoadNext(
        fake.db as never,
        {
          phase: "load_next",
          cursor: cursor(),
          executionArn: "arn:exec",
        },
        NOW,
      ),
    ).rejects.toThrow(/another tenant/);
  });

  it("returns terminal_canceled for a canceled run", async () => {
    fake.selectQueue.push([runRow({ status: "canceled" })]);
    const result = await handleLoadNext(
      fake.db as never,
      { phase: "load_next", cursor: cursor(), executionArn: "arn:exec" },
      NOW,
    );
    expect(result.directive).toBe("terminal_canceled");
  });

  it("returns wait_until with a valid ISO timestamp for a wait step", async () => {
    const waitDef: WorkflowDefinition = {
      version: 1,
      steps: [{ id: "cool-off", kind: "wait", durationSeconds: 60 }],
    };
    fake.selectQueue.push([runRow()], [versionRow(waitDef)]);
    const result = await handleLoadNext(
      fake.db as never,
      { phase: "load_next", cursor: cursor(), executionArn: "arn:exec" },
      NOW,
    );
    expect(result.directive).toBe("wait_until");
    expect(result.until).toBeTruthy();
    expect(Number.isNaN(Date.parse(result.until as string))).toBe(false);
    expect(result.until).toBe(new Date(NOW.getTime() + 60_000).toISOString());
  });

  it("fails the run cleanly for a valid-but-not-yet-executable step kind", async () => {
    const toolDef: WorkflowDefinition = {
      version: 1,
      steps: [{ id: "crunch", kind: "tool", tool: "emit_document" }],
    };
    fake.selectQueue.push([runRow()], [versionRow(toolDef)]);
    const result = await handleLoadNext(
      fake.db as never,
      { phase: "load_next", cursor: cursor(), executionArn: "arn:exec" },
      NOW,
    );
    expect(result.directive).toBe("terminal_failure");
    const event = fake.inserts.find(
      (row) => row.event_type === "workflow_step_failed",
    ) as { payload_summary?: Record<string, unknown> } | undefined;
    expect(event?.payload_summary).toMatchObject({
      stepId: "crunch",
      stepKind: "tool",
      reason: "step_kind_not_executable",
    });
  });
});

// ---------------------------------------------------------------------------
// dispatch_agent
// ---------------------------------------------------------------------------

describe("dispatch_agent", () => {
  it("stores the token, records step_started, enqueues one wakeup", async () => {
    fake.selectQueue.push([runRow()], [versionRow()], []); // run, version, no existing wakeup
    const result = await handleDispatchAgent(
      fake.db as never,
      { phase: "dispatch_agent", cursor: cursor(), taskToken: "tok-1" },
      NOW,
    );
    expect(result).toEqual({ ok: true });

    const token = fake.inserts.find((i) => i.purpose === "agent_step");
    expect(token?.token).toBe("tok-1");

    const started = fake.inserts.find(
      (i) => i.event_type === "workflow_step_started",
    );
    expect(started).toBeTruthy();
    expect((started?.payload_summary as Record<string, unknown>).status).toBe(
      "running",
    );

    const wakeups = fake.inserts.filter((i) => i.source === "workflow_step");
    expect(wakeups).toHaveLength(1);
    expect(wakeups[0].idempotency_key).toBe(
      "workflow-run:run-1:step:draft:iteration:1",
    );
    const payload = wakeups[0].payload as {
      goalMode: { goalRunId: string };
    };
    expect(payload.goalMode.goalRunId).toBe("run-1:1");
  });

  it("reuses an existing wakeup — no second insert", async () => {
    fake.selectQueue.push([runRow()], [versionRow()], [{ id: "wakeup-1" }]);
    await handleDispatchAgent(
      fake.db as never,
      { phase: "dispatch_agent", cursor: cursor(), taskToken: "tok-2" },
      NOW,
    );
    const wakeups = fake.inserts.filter((i) => i.source === "workflow_step");
    expect(wakeups).toHaveLength(0);
  });

  it("throws when the run records no acting agent", async () => {
    fake.selectQueue.push([runRow({ input_summary: {} })], [versionRow()], []);
    await expect(
      handleDispatchAgent(
        fake.db as never,
        { phase: "dispatch_agent", cursor: cursor(), taskToken: "tok-3" },
        NOW,
      ),
    ).rejects.toThrow(/no agent to dispatch/);
  });
});

// ---------------------------------------------------------------------------
// execute_step (THINK-215)
// ---------------------------------------------------------------------------

function makeExecutors(overrides: Partial<StepExecutors> = {}): StepExecutors {
  return {
    invokeRoutine: async () => ({
      status: "succeeded",
      executionId: "exec-1",
      outputJson: { ok: true },
    }),
    httpFetch: (async () => ({
      ok: true,
      status: 200,
      text: async () => '{"echo":true}',
    })) as unknown as typeof fetch,
    ...overrides,
  };
}

describe("execute_step", () => {
  it("emit_event: records started/output/finished and completes a single-step run", async () => {
    const def: WorkflowDefinition = {
      version: 1,
      steps: [
        {
          id: "announce",
          kind: "emit_event",
          eventType: "probe.done",
          payload: { note: "{{ run.input.note }}" },
        },
      ],
    };
    fake.selectQueue.push(
      [runRow({ input_summary: { note: "weekly" } })],
      [versionRow(def)],
      [], // no prior completion
      [], // no prior step outputs
      [], // no prior policy decision
    );
    const result = await handleExecuteStep(
      fake.db as never,
      { phase: "execute_step", cursor: cursor() },
      NOW,
      makeExecutors(),
    );
    expect(result.directive).toBe("terminal_success");
    const types = fake.inserts.map((r) => r.event_type ?? r.evidence_type);
    expect(types).toContain("workflow_step_started");
    expect(types).toContain("step_output");
    expect(types).toContain("workflow_step_finished");
    expect(types).toContain("workflow_policy_decision");
    const output = fake.inserts.find(
      (r) => r.evidence_type === "step_output",
    ) as {
      summary?: { output?: { payload?: { note?: string } } };
    };
    expect(output?.summary?.output?.payload?.note).toBe("weekly");
  });

  it("routine: invokes the existing engine and stores its output", async () => {
    const def: WorkflowDefinition = {
      version: 1,
      steps: [
        { id: "crunch", kind: "routine", routineId: "r-9", input: { n: 1 } },
        { id: "after", kind: "emit_event", eventType: "x.y" },
      ],
    };
    const calls: unknown[] = [];
    fake.selectQueue.push([runRow()], [versionRow(def)], [], [], []);
    const result = await handleExecuteStep(
      fake.db as never,
      { phase: "execute_step", cursor: cursor() },
      NOW,
      makeExecutors({
        invokeRoutine: async (input) => {
          calls.push(input);
          return {
            status: "succeeded",
            executionId: "e-1",
            outputJson: { v: 7 },
          };
        },
      }),
    );
    expect(calls).toEqual([{ routineId: "r-9", input: { n: 1 } }]);
    expect(result.directive).toBe("continue");
    expect(result.cursor.stepPointer).toBe(1);
    const output = fake.inserts.find(
      (r) => r.evidence_type === "step_output",
    ) as {
      summary?: { output?: { result?: { v?: number } } };
    };
    expect(output?.summary?.output?.result?.v).toBe(7);
  });

  it("http: a non-2xx response fails the step and the run (mid-workflow)", async () => {
    const def: WorkflowDefinition = {
      version: 1,
      steps: [
        { id: "post", kind: "http", method: "POST", url: "https://x.dev/hook" },
        { id: "after", kind: "emit_event", eventType: "x.y" },
      ],
    };
    fake.selectQueue.push([runRow()], [versionRow(def)], [], [], []);
    const result = await handleExecuteStep(
      fake.db as never,
      { phase: "execute_step", cursor: cursor() },
      NOW,
      makeExecutors({
        httpFetch: (async () => ({
          ok: false,
          status: 502,
          text: async () => "bad gateway",
        })) as unknown as typeof fetch,
      }),
    );
    expect(result.directive).toBe("terminal_failure");
    const failed = fake.inserts.find(
      (r) => r.event_type === "workflow_step_failed",
    ) as { payload_summary?: { errorSummary?: string } };
    expect(failed?.payload_summary?.errorSummary).toContain("502");
  });

  it("unresolved template references fail the step in ThinkWork terms", async () => {
    const def: WorkflowDefinition = {
      version: 1,
      steps: [
        {
          id: "announce",
          kind: "emit_event",
          eventType: "x.y",
          payload: { v: "{{ run.input.absent }}" },
        },
      ],
    };
    fake.selectQueue.push([runRow()], [versionRow(def)], [], [], []);
    const result = await handleExecuteStep(
      fake.db as never,
      { phase: "execute_step", cursor: cursor() },
      NOW,
      makeExecutors(),
    );
    expect(result.directive).toBe("terminal_failure");
    const failed = fake.inserts.find(
      (r) => r.event_type === "workflow_step_failed",
    ) as { payload_summary?: { errorSummary?: string } };
    expect(failed?.payload_summary?.errorSummary).toContain("run.input.absent");
  });

  it("replays a recorded completion without re-executing side effects", async () => {
    const def: WorkflowDefinition = {
      version: 1,
      steps: [{ id: "announce", kind: "emit_event", eventType: "x.y" }],
    };
    let fetchCalls = 0;
    fake.selectQueue.push(
      [runRow()],
      [versionRow(def)],
      [{ event_type: "workflow_step_finished" }], // prior completion exists
      [], // prior policy decision check
    );
    const result = await handleExecuteStep(
      fake.db as never,
      { phase: "execute_step", cursor: cursor() },
      NOW,
      makeExecutors({
        httpFetch: (async () => {
          fetchCalls += 1;
          throw new Error("must not execute");
        }) as unknown as typeof fetch,
      }),
    );
    expect(fetchCalls).toBe(0);
    expect(result.directive).toBe("terminal_success");
    // No duplicate completion event — only the policy decision is recorded.
    const completions = fake.inserts.filter(
      (r) => r.event_type === "workflow_step_finished",
    );
    expect(completions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// approval step (THINK-215)
// ---------------------------------------------------------------------------

const APPROVAL_MID_DEF: WorkflowDefinition = {
  version: 1,
  steps: [
    { id: "sign-off", kind: "approval", prompt: "Ship it?" },
    { id: "announce", kind: "emit_event", eventType: "x.y" },
  ],
};

describe("approval step", () => {
  it("load_next marks the run waiting_for_human and parks on await_approval", async () => {
    fake.selectQueue.push([runRow()], [versionRow(APPROVAL_MID_DEF)]);
    const result = await handleLoadNext(
      fake.db as never,
      { phase: "load_next", cursor: cursor(), executionArn: "arn:exec" },
      NOW,
    );
    expect(result.directive).toBe("await_approval");
    const started = fake.inserts.find(
      (r) => r.event_type === "workflow_step_started",
    ) as { payload_summary?: Record<string, unknown> };
    expect(started?.payload_summary).toMatchObject({
      stepId: "sign-off",
      stepKind: "approval",
      status: "waiting",
    });
    const runPatch = fake.updates.find((u) => u.status === "waiting_for_human");
    expect(runPatch).toBeTruthy();
  });

  it("record_approval on an approval STEP advances the pointer, not the iteration", async () => {
    fake.selectQueue.push(
      [runRow()],
      [versionRow(APPROVAL_MID_DEF)],
      [], // prior policy decision check in advance tail
    );
    const result = await handleRecordApproval(
      fake.db as never,
      {
        phase: "record_approval",
        cursor: cursor(),
        approval: { approved: true, note: "go" },
      },
      NOW,
    );
    expect(result.directive).toBe("continue");
    expect(result.cursor).toMatchObject({ stepPointer: 1, iteration: 1 });
    const decision = fake.inserts.find(
      (r) => r.event_type === "workflow_approval_decision",
    ) as { payload_summary?: Record<string, unknown> };
    expect(decision?.payload_summary).toMatchObject({
      stepId: "sign-off",
      decision: "approved",
    });
  });

  it("record_approval deny on an approval STEP cancels the run", async () => {
    fake.selectQueue.push([runRow()], [versionRow(APPROVAL_MID_DEF)]);
    const result = await handleRecordApproval(
      fake.db as never,
      {
        phase: "record_approval",
        cursor: cursor(),
        approval: { approved: false, note: "not yet" },
      },
      NOW,
    );
    expect(result.directive).toBe("terminal_canceled");
    const decision = fake.inserts.find(
      (r) => r.event_type === "workflow_approval_decision",
    ) as { payload_summary?: Record<string, unknown> };
    expect(decision?.payload_summary).toMatchObject({
      stepId: "sign-off",
      decision: "rejected",
    });
  });
});
