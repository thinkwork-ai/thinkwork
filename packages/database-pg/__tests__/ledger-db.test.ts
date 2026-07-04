/**
 * Characterization tests for the shared DB-backed AgentLoop dispatch ledger
 * (THINK-137 U2). A mock Drizzle handle records the exact insert/update
 * `values` passed for each row so the run/iteration/wakeup row shapes are
 * pinned — the scheduled path (job-trigger) and the manual path
 * (triggerAgentLoopRun) now share this one factory, so identical shapes are
 * structural, and these tests fail loudly if the shape drifts.
 *
 * Also covers the enqueueWakeup lookup-or-insert that prevents a repair from
 * double-dispatching (Verification Contract scenario 4).
 */

import { describe, expect, it } from "vitest";
import type { Database } from "../src/db";
import {
  createDbAgentLoopLedger,
  loadAgentLoopRunRepairState,
} from "../src/ledger-db";
import {
  agentLoopIterations,
  agentLoopRuns,
  agentWakeupRequests,
} from "../src/schema/index";
import type {
  AgentLoopCreateIterationInput,
  AgentLoopCreateRunInput,
  AgentLoopEnqueueWakeupInput,
} from "@thinkwork/agent-loops-core";

interface RecordedCall {
  op: "select" | "insert" | "update";
  table: unknown;
  values?: Record<string, unknown>;
  set?: Record<string, unknown>;
}

/**
 * Minimal chainable Drizzle stub. `selectResults` is a queue consumed in
 * call order; each terminal `.limit()` / `.returning()` / update `.where()`
 * pops the next canned result.
 */
function mockDb(selectResults: unknown[][] = [], insertResults: unknown[][] = []) {
  const calls: RecordedCall[] = [];
  const selectQueue = [...selectResults];
  const insertQueue = [...insertResults];

  const db = {
    select() {
      let table: unknown;
      const chain: Record<string, unknown> = {
        from(t: unknown) {
          table = t;
          return chain;
        },
        where() {
          return chain;
        },
        limit() {
          calls.push({ op: "select", table });
          return Promise.resolve(selectQueue.shift() ?? []);
        },
      };
      return chain;
    },
    insert(table: unknown) {
      let values: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {
        values(v: Record<string, unknown>) {
          values = v;
          return chain;
        },
        returning() {
          calls.push({ op: "insert", table, values });
          return Promise.resolve(insertQueue.shift() ?? [{ id: "generated-id" }]);
        },
      };
      return chain;
    },
    update(table: unknown) {
      let set: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {
        set(s: Record<string, unknown>) {
          set = s;
          return chain;
        },
        where() {
          calls.push({ op: "update", table, set });
          return Promise.resolve();
        },
      };
      return chain;
    },
  };
  return { db: db as unknown as Database, calls };
}

const NOW = new Date("2026-07-04T00:00:00Z");

const runInput = (
  overrides: Partial<AgentLoopCreateRunInput> = {},
): AgentLoopCreateRunInput => ({
  tenantId: "tenant-1",
  agentLoopId: "loop-1",
  agentLoopVersionId: "version-1",
  status: "queued",
  triggerFamily: "schedule",
  triggerSource: "agent_loop_schedule",
  scheduledJobId: "job-1",
  actorType: "system",
  actorId: null,
  idempotencyKey: "agent_loop_schedule:job-1:fire-1",
  correlationId: "agent_loop_schedule:job-1",
  currentIteration: 1,
  policySnapshot: { maxIterations: 2 },
  inputSummary: { scheduleName: "Daily", prompt: null },
  errorCode: null,
  errorMessage: null,
  now: NOW,
  ...overrides,
});

const iterationInput = (
  overrides: Partial<AgentLoopCreateIterationInput> = {},
): AgentLoopCreateIterationInput => ({
  tenantId: "tenant-1",
  runId: "run-1",
  iterationNumber: 1,
  status: "queued",
  goalModeAction: "start",
  inputSummary: { scheduleName: "Daily", prompt: null },
  errorCode: null,
  errorMessage: null,
  now: NOW,
  ...overrides,
});

const wakeupInput = (
  overrides: Partial<AgentLoopEnqueueWakeupInput> = {},
): AgentLoopEnqueueWakeupInput => ({
  tenantId: "tenant-1",
  agentId: "agent-1",
  source: "agent_loop",
  triggerDetail: "agent_loop:loop-1:agent_loop_schedule",
  reason: "Prepare the daily research brief.",
  payload: {
    message: "Prepare the daily research brief.",
    goalMode: {
      enabled: true,
      action: "start",
      objective: "Prepare the daily research brief.",
      goalRunId: "run-1",
      resolvedBudget: { tokenBudget: 12_000 },
    },
    agentLoop: {
      loopId: "loop-1",
      runId: "run-1",
      iterationId: "iteration-1",
      versionId: "version-1",
      triggerFamily: "schedule",
      triggerSource: "agent_loop_schedule",
      completionCriteria: ["A useful brief exists."],
      judgeMode: "self_check",
      loopPolicy: {
        maxIterations: 2,
        maxTokens: 12_000,
        failBehavior: "return_blocker",
        escalateOnFailure: false,
      },
    },
  },
  idempotencyKey: "agent-loop:run-1:iteration:1",
  requestedByActorType: "system",
  requestedByActorId: null,
  now: NOW,
  ...overrides,
});

describe("createDbAgentLoopLedger row shapes (scenario 1)", () => {
  it("createRun inserts the pinned agent_loop_runs field set", async () => {
    const { db, calls } = mockDb([], [[{ id: "run-1", status: "queued" }]]);
    const ledger = createDbAgentLoopLedger(db);

    const ref = await ledger.createRun(runInput());

    expect(ref).toEqual({ id: "run-1", status: "queued" });
    const insert = calls.find((c) => c.op === "insert");
    expect(insert?.table).toBe(agentLoopRuns);
    expect(insert?.values).toEqual({
      tenant_id: "tenant-1",
      agent_loop_id: "loop-1",
      agent_loop_version_id: "version-1",
      status: "queued",
      trigger_family: "schedule",
      trigger_source: "agent_loop_schedule",
      scheduled_job_id: "job-1",
      actor_type: "system",
      actor_id: null,
      idempotency_key: "agent_loop_schedule:job-1:fire-1",
      correlation_id: "agent_loop_schedule:job-1",
      current_iteration: 1,
      policy_snapshot: { maxIterations: 2 },
      input_summary: { scheduleName: "Daily", prompt: null },
      error_code: null,
      error_message: null,
      last_event_at: NOW,
      created_at: NOW,
      updated_at: NOW,
    });
  });

  it("createIteration inserts the pinned agent_loop_iterations field set", async () => {
    const { db, calls } = mockDb([], [[{ id: "iteration-1" }]]);
    const ledger = createDbAgentLoopLedger(db);

    const ref = await ledger.createIteration(iterationInput());

    expect(ref).toEqual({ id: "iteration-1" });
    const insert = calls.find((c) => c.op === "insert");
    expect(insert?.table).toBe(agentLoopIterations);
    expect(insert?.values).toEqual({
      tenant_id: "tenant-1",
      agent_loop_run_id: "run-1",
      iteration_number: 1,
      status: "queued",
      goal_mode_action: "start",
      input_summary: { scheduleName: "Daily", prompt: null },
      error_code: null,
      error_message: null,
      created_at: NOW,
      updated_at: NOW,
    });
  });

  it("enqueueWakeup inserts the pinned agent_wakeup_requests field set on a fresh key", async () => {
    // First select (lookup-or-insert probe) returns no existing row.
    const { db, calls } = mockDb([[]], [[{ id: "wakeup-1" }]]);
    const ledger = createDbAgentLoopLedger(db);

    const ref = await ledger.enqueueWakeup(wakeupInput());

    expect(ref).toEqual({ id: "wakeup-1" });
    const insert = calls.find((c) => c.op === "insert");
    expect(insert?.table).toBe(agentWakeupRequests);
    expect(insert?.values).toMatchObject({
      tenant_id: "tenant-1",
      agent_id: "agent-1",
      source: "agent_loop",
      trigger_detail: "agent_loop:loop-1:agent_loop_schedule",
      reason: "Prepare the daily research brief.",
      status: "queued",
      idempotency_key: "agent-loop:run-1:iteration:1",
      requested_by_actor_type: "system",
      requested_by_actor_id: null,
      requested_at: NOW,
      created_at: NOW,
    });
  });
});

describe("createDbAgentLoopLedger enqueueWakeup lookup-or-insert (scenario 4)", () => {
  it("returns the existing wakeup row without inserting a second one", async () => {
    // Lookup probe finds a pre-existing wakeup (crash after insert, before
    // markIterationWakeup). enqueueWakeup must NOT insert again.
    const { db, calls } = mockDb([[{ id: "wakeup-preexisting" }]]);
    const ledger = createDbAgentLoopLedger(db);

    const ref = await ledger.enqueueWakeup(wakeupInput());

    expect(ref).toEqual({ id: "wakeup-preexisting" });
    expect(calls.filter((c) => c.op === "insert")).toHaveLength(0);
    expect(calls.filter((c) => c.op === "select")).toHaveLength(1);
  });
});

describe("createDbAgentLoopLedger hooks", () => {
  it("wires an injected runRoutineAction hook and omits it otherwise", () => {
    const { db } = mockDb();
    const runRoutineAction = async () => ({
      routineId: "r",
      label: null,
      status: "succeeded" as const,
    });
    expect(createDbAgentLoopLedger(db).runRoutineAction).toBeUndefined();
    expect(
      createDbAgentLoopLedger(db, { runRoutineAction }).runRoutineAction,
    ).toBe(runRoutineAction);
  });
});

describe("loadAgentLoopRunRepairState", () => {
  it("reports a half-built start (queued run, iteration with no wakeup)", async () => {
    const { db } = mockDb([
      [{ id: "run-1", status: "queued" }],
      [{ id: "iter-1", wakeupId: null }],
    ]);

    const state = await loadAgentLoopRunRepairState(db, "tenant-1", "run-1");

    expect(state).toEqual({
      status: "queued",
      iterationId: "iter-1",
      hasWakeup: false,
    });
  });

  it("reports a complete run (iteration recorded a wakeup)", async () => {
    const { db } = mockDb([
      [{ id: "run-1", status: "queued" }],
      [{ id: "iter-1", wakeupId: "wakeup-1" }],
    ]);

    const state = await loadAgentLoopRunRepairState(db, "tenant-1", "run-1");

    expect(state).toEqual({
      status: "queued",
      iterationId: "iter-1",
      hasWakeup: true,
    });
  });

  it("returns null when the run is missing", async () => {
    const { db } = mockDb([[]]);
    expect(
      await loadAgentLoopRunRepairState(db, "tenant-1", "run-x"),
    ).toBeNull();
  });
});
