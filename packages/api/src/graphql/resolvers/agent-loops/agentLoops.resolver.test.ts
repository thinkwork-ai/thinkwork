import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectRows: vi.fn(),
  insertValues: vi.fn(),
  updateValues: vi.fn(),
  requireAdminOrServiceCaller: vi.fn(),
  resolveCallerUserId: vi.fn(),
  ensureThreadForWork: vi.fn(),
}));

let selectCall = 0;
let insertCall = 0;

vi.mock("../../utils.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => {
            selectCall += 1;
            return mocks.selectRows(selectCall);
          },
        }),
      }),
    }),
    insert: () => ({
      values: (values: unknown) => {
        insertCall += 1;
        mocks.insertValues(insertCall, values);
        return {
          returning: () =>
            Promise.resolve(
              insertCall === 1
                ? [
                    {
                      id: "run-1",
                      tenant_id: "tenant-1",
                      agent_loop_id: "loop-1",
                      agent_loop_version_id: "version-1",
                      status: "queued",
                      trigger_family: "manual",
                      current_iteration: 1,
                      policy_snapshot: {},
                      created_at: new Date("2026-06-22T00:00:00Z"),
                      updated_at: new Date("2026-06-22T00:00:00Z"),
                    },
                  ]
                : insertCall === 2
                  ? [{ id: "iteration-1" }]
                  : insertCall === 3
                    ? [{ id: "wakeup-1" }]
                    : [],
            ),
        };
      },
    }),
    update: () => ({
      set: (values: unknown) => {
        mocks.updateValues(values);
        return {
          where: () => Promise.resolve([]),
        };
      },
    }),
  },
  agentLoops: {
    id: "agent_loops.id",
    tenant_id: "agent_loops.tenant_id",
    name: "agent_loops.name",
    enabled: "agent_loops.enabled",
    lifecycle_status: "agent_loops.lifecycle_status",
    space_id: "agent_loops.space_id",
  },
  agents: {
    id: "agents.id",
    tenant_id: "agents.tenant_id",
    runtime_config: "agents.runtime_config",
  },
  spaces: {
    id: "spaces.id",
    tenant_id: "spaces.tenant_id",
    status: "spaces.status",
  },
  agentLoopVersions: {
    id: "agent_loop_versions.id",
    version_status: "agent_loop_versions.version_status",
    goal_spec: "agent_loop_versions.goal_spec",
    worker_spec: "agent_loop_versions.worker_spec",
    judge_spec: "agent_loop_versions.judge_spec",
    loop_policy: "agent_loop_versions.loop_policy",
  },
  agentLoopRuns: {
    id: "agent_loop_runs.id",
    status: "agent_loop_runs.status",
    tenant_id: "agent_loop_runs.tenant_id",
    agent_loop_id: "agent_loop_runs.agent_loop_id",
    idempotency_key: "agent_loop_runs.idempotency_key",
  },
  agentLoopIterations: {},
  agentWakeupRequests: { id: "agent_wakeup_requests.id" },
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  snakeToCamel: (row: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
        value instanceof Date ? value.toISOString() : value,
      ]),
    ),
}));

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: mocks.requireAdminOrServiceCaller,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerUserId: mocks.resolveCallerUserId,
}));

vi.mock("../../../lib/thread-helpers.js", () => ({
  ensureThreadForWork: mocks.ensureThreadForWork,
}));

// eslint-disable-next-line import/first
import { triggerAgentLoopRun } from "./triggerAgentLoopRun.mutation.js";

const ctx = () =>
  ({
    auth: {
      authType: "cognito" as const,
      principalId: "sub-1",
      tenantId: "tenant-1",
      email: "eric@example.com",
      agentId: null,
    },
  }) as any;

beforeEach(() => {
  selectCall = 0;
  insertCall = 0;
  mocks.selectRows.mockReset();
  mocks.insertValues.mockReset();
  mocks.updateValues.mockReset();
  mocks.requireAdminOrServiceCaller.mockReset();
  mocks.resolveCallerUserId.mockReset().mockResolvedValue("user-1");
  mocks.ensureThreadForWork.mockReset().mockResolvedValue({
    threadId: "thread-1",
    identifier: "AUTO-1",
    number: 1,
  });
});

describe("AgentLoop resolvers", () => {
  it("auth-gates manual run creation by loop tenant", async () => {
    mocks.selectRows.mockResolvedValueOnce([
      {
        id: "loop-1",
        tenant_id: "tenant-1",
        current_version_id: "version-1",
      },
    ]);
    mocks.requireAdminOrServiceCaller.mockRejectedValue(
      Object.assign(new Error("Tenant admin role required"), {
        extensions: { code: "FORBIDDEN" },
      }),
    );

    await expect(
      triggerAgentLoopRun(null, { input: { agentLoopId: "loop-1" } }, ctx()),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });

    expect(mocks.requireAdminOrServiceCaller).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-1",
      "trigger_agent_loop_run",
    );
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it("creates a queued run plus first queued iteration for manual trigger", async () => {
    mocks.requireAdminOrServiceCaller.mockResolvedValue(undefined);
    mocks.selectRows.mockImplementation(async (call: number) => {
      if (call === 1) {
        return [
          {
            id: "loop-1",
            tenant_id: "tenant-1",
            name: "Loop",
            enabled: true,
            lifecycle_status: "active",
            current_version_id: "version-1",
            space_id: "loop-space-1",
          },
        ];
      }
      if (call === 2) {
        return [
          {
            id: "version-1",
            version_status: "active",
            goal_spec: {
              objective: "Do the thing",
              completionCriteria: ["Thing is done"],
            },
            worker_spec: {
              type: "agent",
              id: "agent-1",
              toolHints: [],
              config: {},
            },
            judge_spec: {
              mode: "self_check",
              criteria: [],
              config: {},
            },
            loop_policy: { maxIterations: 1 },
          },
        ];
      }
      if (call === 3) return [];
      if (call === 4) {
        return [{ id: "loop-space-1" }];
      }
      if (call === 5) return [];
      if (call === 6) {
        return [
          {
            id: "run-1",
            tenant_id: "tenant-1",
            agent_loop_id: "loop-1",
            agent_loop_version_id: "version-1",
            status: "queued",
            trigger_family: "manual",
            current_iteration: 1,
            policy_snapshot: {},
            created_at: new Date("2026-06-22T00:00:00Z"),
            updated_at: new Date("2026-06-22T00:00:00Z"),
          },
        ];
      }
      return [];
    });

    const result = await triggerAgentLoopRun(
      null,
      {
        input: {
          agentLoopId: "loop-1",
          idempotencyKey: "idem-1",
          inputSummary: { reason: "operator-test" },
        },
      },
      ctx(),
    );

    expect(result).toMatchObject({
      id: "run-1",
      tenantId: "tenant-1",
      agentLoopId: "loop-1",
      status: "queued",
      triggerFamily: "manual",
      currentIteration: 1,
    });
    expect(mocks.insertValues).toHaveBeenNthCalledWith(
      1,
      1,
      expect.objectContaining({
        tenant_id: "tenant-1",
        agent_loop_id: "loop-1",
        agent_loop_version_id: "version-1",
        status: "queued",
        trigger_family: "manual",
        actor_type: "user",
        actor_id: "user-1",
        idempotency_key: "idem-1",
        current_iteration: 1,
        policy_snapshot: { maxIterations: 1 },
        input_summary: { reason: "operator-test" },
      }),
    );
    expect(mocks.insertValues).toHaveBeenNthCalledWith(
      2,
      2,
      expect.objectContaining({
        tenant_id: "tenant-1",
        agent_loop_run_id: "run-1",
        iteration_number: 1,
        status: "queued",
      }),
    );
    expect(mocks.insertValues).toHaveBeenNthCalledWith(
      3,
      3,
      expect.objectContaining({
        tenant_id: "tenant-1",
        agent_id: "agent-1",
        source: "agent_loop",
        idempotency_key: "agent-loop:run-1:iteration:1",
        payload: expect.objectContaining({
          threadId: "thread-1",
          spaceId: "loop-space-1",
          goalMode: expect.objectContaining({
            enabled: true,
            action: "start",
            goalRunId: "run-1",
          }),
          agentLoop: expect.objectContaining({
            loopId: "loop-1",
            iterationId: "iteration-1",
          }),
        }),
      }),
    );
    expect(mocks.ensureThreadForWork).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      agentId: "agent-1",
      spaceId: "loop-space-1",
      userId: "user-1",
      title: "Automation: Loop",
      channel: "schedule",
    });
    expect(mocks.updateValues).toHaveBeenCalledWith(
      expect.objectContaining({
        last_run_id: "run-1",
        last_run_status: "queued",
      }),
    );
  });
});
