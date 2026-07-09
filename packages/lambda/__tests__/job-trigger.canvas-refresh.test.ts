/**
 * Tests for the canvas_refresh branch in packages/lambda/job-trigger.ts
 * (Living Artifacts THINK-145 U7).
 *
 * Scenarios (per plan):
 *   * saved artifact → invokes canvas-refresh Lambda RequestResponse
 *   * artifact deleted → pauses the schedule (enabled=false) with a surfaced
 *     reason; no invoke
 *   * artifact reverted to draft → pauses the schedule; no invoke
 *
 * DB + Lambda client mocked at the module boundary, mirroring
 * job-trigger.skill-run.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSelect, mockInsert, mockUpdate, mockUpdateSet, mockLambdaSend } =
  vi.hoisted(() => ({
    mockSelect: vi.fn(),
    mockInsert: vi.fn(),
    mockUpdate: vi.fn(),
    mockUpdateSet: vi.fn(),
    mockLambdaSend: vi.fn(),
  }));

type Rows = Record<string, unknown>[];

const selectChain = (rows: Rows) => ({
  from: () => ({
    where: () => {
      const resolved = Promise.resolve(rows);
      return {
        limit: () => resolved,
        orderBy: () => ({ limit: () => resolved }),
        then: (
          resolve: (value: Rows) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => resolved.then(resolve, reject),
      };
    },
  }),
});

const insertChain = (rows: Rows) => ({
  values: () => ({
    returning: () => Promise.resolve(rows),
    onConflictDoNothing: () => ({ returning: () => Promise.resolve(rows) }),
  }),
});

const updateChain = () => ({
  set: (value: Record<string, unknown>) => {
    mockUpdateSet(value);
    return {
      where: () => Promise.resolve(),
      returning: () => Promise.resolve([]),
    };
  },
});

vi.mock("@thinkwork/database-pg", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@thinkwork/database-pg")>();
  return {
    ...actual,
    getDb: () => ({
      select: () => selectChain((mockSelect() as Rows) ?? []),
      insert: () => insertChain((mockInsert() as Rows) ?? []),
      update: () => {
        mockUpdate();
        return updateChain();
      },
    }),
  };
});

vi.mock("@thinkwork/database-pg/schema", () => ({
  artifacts: {
    id: "artifacts.id",
    tenant_id: "artifacts.tenant_id",
    status: "artifacts.status",
  },
  agents: { id: "agents.id" },
  agentLoopRuns: { id: "agent_loop_runs.id" },
  agentLoopVersions: { id: "agent_loop_versions.id" },
  agentLoops: { id: "agent_loops.id" },
  budgetPolicies: {
    tenant_id: "budget_policies.tenant_id",
    scope: "budget_policies.scope",
    user_id: "budget_policies.user_id",
    enabled: "budget_policies.enabled",
  },
  costEvents: { tenant_id: "cost_events.tenant_id" },
  evalRuns: { id: "eval_runs.id" },
  routineAslVersions: { id: "routine_asl_versions.id" },
  routineExecutions: { id: "routine_executions.id" },
  routines: { id: "routines.id" },
  scheduledJobs: {
    id: "scheduled_jobs.id",
    tenant_id: "scheduled_jobs.tenant_id",
    enabled: "scheduled_jobs.enabled",
    budget_paused: "scheduled_jobs.budget_paused",
    name: "scheduled_jobs.name",
    agent_id: "scheduled_jobs.agent_id",
    agent_loop_id: "scheduled_jobs.agent_loop_id",
    space_id: "scheduled_jobs.space_id",
    prompt: "scheduled_jobs.prompt",
    config: "scheduled_jobs.config",
    created_by_type: "scheduled_jobs.created_by_type",
    created_by_id: "scheduled_jobs.created_by_id",
    last_run_at: "scheduled_jobs.last_run_at",
    updated_at: "scheduled_jobs.updated_at",
  },
  agentWakeupRequests: {
    id: "agent_wakeup_requests.id",
    tenant_id: "agent_wakeup_requests.tenant_id",
    idempotency_key: "agent_wakeup_requests.idempotency_key",
  },
  tenantMembers: {
    tenant_id: "tenant_members.tenant_id",
    status: "tenant_members.status",
    role: "tenant_members.role",
    principal_id: "tenant_members.principal_id",
    created_at: "tenant_members.created_at",
  },
  skillRuns: { id: "skill_runs.id" },
  tenants: { id: "tenants.id" },
  tenantSettings: { tenant_id: "tenant_settings.tenant_id" },
  threadIdleLearningRuns: { id: "thread_idle_learning_runs.id" },
  threadIdleLearningState: { id: "thread_idle_learning_state.id" },
  threadTurns: { id: "thread_turns.id" },
  workflowEngineBindings: { id: "workflow_engine_bindings.id" },
  workflowEvidence: { id: "workflow_evidence.id" },
  workflowRuns: { id: "workflow_runs.id" },
  workflowTriggers: { id: "workflow_triggers.id" },
  workflowVersions: { id: "workflow_versions.id" },
  workflows: { id: "workflows.id" },
  users: { id: "users.id", tenant_id: "users.tenant_id" },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ _and: args }),
  eq: (...args: unknown[]) => ({ _eq: args }),
  gte: (...args: unknown[]) => ({ _gte: args }),
  asc: (...args: unknown[]) => ({ _asc: args }),
  inArray: (...args: unknown[]) => ({ _inArray: args }),
  sql: (...args: unknown[]) => ({ _sql: args }),
  relations: () => ({}),
}));

vi.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: vi.fn().mockImplementation(() => ({ send: mockLambdaSend })),
  InvokeCommand: vi.fn().mockImplementation((input) => ({ input })),
}));

import { handler } from "../job-trigger.js";

const EVENT = {
  triggerId: "job-canvas-1",
  triggerType: "canvas_refresh",
  tenantId: "T1",
} as never;

/** Job row (owner=null so the budget path runs zero selects). */
const jobRow = (config: Record<string, unknown>) => ({
  enabled: true,
  budget_paused: false,
  name: "Canvas refresh",
  config,
  created_by_type: "system",
  created_by_id: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STAGE = "dev";
  mockLambdaSend.mockResolvedValue({
    FunctionError: undefined,
    Payload: undefined,
  });
});

describe("job-trigger canvas_refresh", () => {
  it("invokes canvas-refresh RequestResponse for a saved artifact", async () => {
    mockSelect
      .mockReturnValueOnce([jobRow({ artifactId: "art-1", partId: "part-9" })])
      .mockReturnValueOnce([{ id: "art-1", status: "final" }]);

    await handler(EVENT);

    expect(mockLambdaSend).toHaveBeenCalledTimes(1);
    const cmd = mockLambdaSend.mock.calls[0]![0] as {
      input: {
        FunctionName: string;
        InvocationType: string;
        Payload: Uint8Array;
      };
    };
    expect(cmd.input.FunctionName).toBe("thinkwork-dev-api-canvas-refresh");
    expect(cmd.input.InvocationType).toBe("RequestResponse");
    const payload = JSON.parse(new TextDecoder().decode(cmd.input.Payload));
    expect(payload).toMatchObject({
      tenantId: "T1",
      artifactId: "art-1",
      partId: "part-9",
      trigger: "schedule",
    });
  });

  it("pauses the schedule (enabled=false) with a surfaced reason when the artifact is gone", async () => {
    mockSelect
      .mockReturnValueOnce([jobRow({ artifactId: "art-1" })])
      .mockReturnValueOnce([]); // artifact lookup: not found

    await handler(EVENT);

    expect(mockLambdaSend).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const setArg = mockUpdateSet.mock.calls[0]![0] as Record<string, unknown>;
    expect(setArg.enabled).toBe(false);
    expect(setArg.config).toMatchObject({
      lastCanvasRefreshPause: { reason: "artifact no longer exists" },
    });
  });

  it("pauses the schedule when the artifact reverted to draft", async () => {
    mockSelect
      .mockReturnValueOnce([jobRow({ artifactId: "art-1" })])
      .mockReturnValueOnce([{ id: "art-1", status: "draft" }]);

    await handler(EVENT);

    expect(mockLambdaSend).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const setArg = mockUpdateSet.mock.calls[0]![0] as Record<string, unknown>;
    expect(setArg.enabled).toBe(false);
    expect(setArg.config).toMatchObject({
      lastCanvasRefreshPause: {
        reason: "artifact reverted to draft (unsaved)",
      },
    });
  });

  it("early-returns without a Lambda invoke when artifactId is missing from config", async () => {
    mockSelect.mockReturnValueOnce([jobRow({})]);

    await handler(EVENT);

    expect(mockLambdaSend).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// THINK-233 — sentinel escalation on a scheduled refresh.
// ---------------------------------------------------------------------------

/** Encode a canvas-refresh Lambda result as the RequestResponse Payload. */
const lambdaResult = (result: Record<string, unknown>) => ({
  FunctionError: undefined,
  Payload: new TextEncoder().encode(JSON.stringify({ ok: true, ...result })),
});

const CHANGED_BINDINGS = [
  { outcome: "refreshed", payloadChanged: true, escalate: false },
];
const UNCHANGED_BINDINGS = [
  { outcome: "refreshed", payloadChanged: false, escalate: false },
];
const SCHEMA_STALE_BINDINGS = [
  { outcome: "schema_stale", payloadChanged: false, escalate: true },
];

const sentinelConfig = (over: Record<string, unknown> = {}) => ({
  artifactId: "art-1",
  sentinel: {
    enabled: true,
    mode: "any_change",
    cooldownMinutes: 360,
    ...over,
  },
});

describe("job-trigger canvas_refresh — sentinel (THINK-233)", () => {
  it("dispatches ONE review turn when a binding materially changed", async () => {
    mockSelect
      .mockReturnValueOnce([jobRow(sentinelConfig())]) // job
      .mockReturnValueOnce([{ id: "art-1", status: "final" }]) // artifact
      .mockReturnValueOnce([{ principal_id: "op-1" }]) // operator identity
      .mockReturnValueOnce([]); // no existing wakeup
    mockInsert.mockReturnValue([{ id: "wk-1" }]);
    mockLambdaSend.mockResolvedValue(
      lambdaResult({
        artifactId: "art-1",
        threadId: "thread-1",
        agentId: "agent-1",
        artifactTitle: "Weekly Revenue",
        bindings: CHANGED_BINDINGS,
      }),
    );

    await handler(EVENT);

    expect(mockInsert).toHaveBeenCalledTimes(1);
    // lastAlertAt stamped back into config.sentinel (a later last_run_at stamp
    // is a separate update — find the config-carrying one).
    const stamp = mockUpdateSet.mock.calls
      .map((c) => c[0] as { config?: { sentinel?: { lastAlertAt?: string } } })
      .find((set) => set.config?.sentinel?.lastAlertAt);
    expect(stamp?.config?.sentinel?.lastAlertAt).toBeTruthy();
  });

  it("does NOT dispatch when no binding changed", async () => {
    mockSelect
      .mockReturnValueOnce([jobRow(sentinelConfig())])
      .mockReturnValueOnce([{ id: "art-1", status: "final" }]);
    mockLambdaSend.mockResolvedValue(
      lambdaResult({
        threadId: "thread-1",
        agentId: "agent-1",
        bindings: UNCHANGED_BINDINGS,
      }),
    );

    await handler(EVENT);

    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("dispatches on a schema_stale binding (dormant escalate flag consumer)", async () => {
    mockSelect
      .mockReturnValueOnce([jobRow(sentinelConfig())])
      .mockReturnValueOnce([{ id: "art-1", status: "final" }])
      .mockReturnValueOnce([{ principal_id: "op-1" }])
      .mockReturnValueOnce([]);
    mockInsert.mockReturnValue([{ id: "wk-1" }]);
    mockLambdaSend.mockResolvedValue(
      lambdaResult({
        threadId: "thread-1",
        agentId: "agent-1",
        artifactTitle: "Weekly Revenue",
        bindings: SCHEMA_STALE_BINDINGS,
      }),
    );

    await handler(EVENT);

    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it("suppresses the dispatch when still inside the cooldown window", async () => {
    const recent = new Date(Date.now() - 5 * 60_000).toISOString();
    mockSelect
      .mockReturnValueOnce([
        jobRow(sentinelConfig({ cooldownMinutes: 360, lastAlertAt: recent })),
      ])
      .mockReturnValueOnce([{ id: "art-1", status: "final" }]);
    mockLambdaSend.mockResolvedValue(
      lambdaResult({
        threadId: "thread-1",
        agentId: "agent-1",
        bindings: CHANGED_BINDINGS,
      }),
    );

    await handler(EVENT);

    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("never dispatches when the sentinel is disabled (refresh-only schedule)", async () => {
    mockSelect
      .mockReturnValueOnce([jobRow({ artifactId: "art-1" })])
      .mockReturnValueOnce([{ id: "art-1", status: "final" }]);
    // Even if the Lambda reports changes, an absent sentinel means no parse.
    mockLambdaSend.mockResolvedValue(
      lambdaResult({
        threadId: "thread-1",
        agentId: "agent-1",
        bindings: CHANGED_BINDINGS,
      }),
    );

    await handler(EVENT);

    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockLambdaSend).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch when the report has no thread/agent to escalate onto", async () => {
    mockSelect
      .mockReturnValueOnce([jobRow(sentinelConfig())])
      .mockReturnValueOnce([{ id: "art-1", status: "final" }]);
    mockLambdaSend.mockResolvedValue(
      lambdaResult({
        threadId: null,
        agentId: null,
        bindings: CHANGED_BINDINGS,
      }),
    );

    await handler(EVENT);

    expect(mockInsert).not.toHaveBeenCalled();
  });
});
