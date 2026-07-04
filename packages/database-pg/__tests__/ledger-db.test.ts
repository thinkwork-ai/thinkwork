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
  inboxItems,
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
      const resolve = () => {
        calls.push({ op: "select", table });
        return Promise.resolve(selectQueue.shift() ?? []);
      };
      // Chain is also thenable so aggregate reads that end at `.where()`
      // (count/sum — no `.limit()`) resolve when awaited, mirroring Drizzle's
      // awaitable query builder. Explicit `.limit()` paths still resolve too.
      const chain: Record<string, unknown> = {
        from(t: unknown) {
          table = t;
          return chain;
        },
        where() {
          return chain;
        },
        limit() {
          return resolve();
        },
        then(onFulfilled: (v: unknown) => unknown, onRejected?: unknown) {
          return resolve().then(onFulfilled, onRejected as never);
        },
      };
      return chain;
    },
    insert(table: unknown) {
      let values: Record<string, unknown> = {};
      let recorded = false;
      const record = () => {
        if (!recorded) {
          calls.push({ op: "insert", table, values });
          recorded = true;
        }
        return Promise.resolve(insertQueue.shift() ?? [{ id: "generated-id" }]);
      };
      const chain: Record<string, unknown> = {
        values(v: Record<string, unknown>) {
          values = v;
          return chain;
        },
        returning() {
          return record();
        },
        // Inserts without `.returning()` (e.g. inbox-item insert) are awaited
        // directly — Drizzle's insert builder is thenable.
        then(onFulfilled: (v: unknown) => unknown, onRejected?: unknown) {
          return record().then(onFulfilled, onRejected as never);
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

// ---------------------------------------------------------------------------
// R11 guard reads + headless-failure inbox (THINK-137 U4)
// ---------------------------------------------------------------------------

describe("countActiveRuns", () => {
  it("counts non-terminal runs for the loop and coerces to a number", async () => {
    const { db, calls } = mockDb([[{ count: 2 }]]);
    const ledger = createDbAgentLoopLedger(db);

    const n = await ledger.countActiveRuns!({
      tenantId: "tenant-1",
      agentLoopId: "loop-1",
    });

    expect(n).toBe(2);
    expect(calls.find((c) => c.op === "select")?.table).toBe(agentLoopRuns);
  });
});

describe("sumMonthlyCostCents (wired-but-inert)", () => {
  it("returns the coalesced month sum", async () => {
    const { db } = mockDb([[{ total: 0 }]]);
    const ledger = createDbAgentLoopLedger(db);

    const cents = await ledger.sumMonthlyCostCents!({
      tenantId: "tenant-1",
      agentLoopId: "loop-1",
      monthStart: new Date("2026-07-01T00:00:00Z"),
    });

    expect(cents).toBe(0);
  });
});

describe("raiseHeadlessFailureItem dedup (R10)", () => {
  it("inserts a new pending inbox item when none is open", async () => {
    // Dedup probe returns no open item → insert.
    const { db, calls } = mockDb([[]]);
    const ledger = createDbAgentLoopLedger(db);

    await ledger.raiseHeadlessFailureItem!({
      tenantId: "tenant-1",
      agentLoopId: "loop-1",
      loopName: "Nightly sync",
      runId: "run-1",
      errorCode: "routine_action_failed",
      errorMessage: "boom",
      now: NOW,
    });

    const insert = calls.find((c) => c.op === "insert");
    expect(insert?.table).toBe(inboxItems);
    expect(insert?.values).toMatchObject({
      tenant_id: "tenant-1",
      type: "automation_headless_failure",
      status: "pending",
      entity_type: "agent_loop",
      entity_id: "loop-1",
      config: {
        runId: "run-1",
        errorCode: "routine_action_failed",
        failureCount: 1,
      },
    });
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });

  it("UPDATES the existing open item (increments failureCount) instead of inserting a duplicate", async () => {
    // Dedup probe finds an open item with a prior count.
    const { db, calls } = mockDb([
      [{ id: "inbox-1", config: { failureCount: 2, runId: "run-old" } }],
    ]);
    const ledger = createDbAgentLoopLedger(db);

    await ledger.raiseHeadlessFailureItem!({
      tenantId: "tenant-1",
      agentLoopId: "loop-1",
      loopName: "Nightly sync",
      runId: "run-2",
      errorCode: "routine_action_failed",
      errorMessage: "boom again",
      now: NOW,
    });

    expect(calls.some((c) => c.op === "insert")).toBe(false);
    const update = calls.find((c) => c.op === "update");
    expect(update?.table).toBe(inboxItems);
    expect(update?.set).toMatchObject({
      config: {
        runId: "run-2",
        errorCode: "routine_action_failed",
        failureCount: 3,
      },
    });
  });
});

describe("loadUserTenantId — run-as tenant cross-check (THINK-137 U5, R5)", () => {
  it("returns the user's tenant id", async () => {
    const { db, calls } = mockDb([[{ tenantId: "tenant-1" }]]);
    const ledger = createDbAgentLoopLedger(db);

    const tenantId = await ledger.loadUserTenantId!({ userId: "user-1" });

    expect(tenantId).toBe("tenant-1");
    expect(calls.some((c) => c.op === "select")).toBe(true);
  });

  it("returns null when the run-as user does not exist (hard-reject upstream)", async () => {
    const { db } = mockDb([[]]);
    const ledger = createDbAgentLoopLedger(db);

    expect(await ledger.loadUserTenantId!({ userId: "ghost" })).toBeNull();
  });
});
