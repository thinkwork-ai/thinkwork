import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRows,
  mockAssertCanReadWorkflowTenant,
  mockTriggerRoutineRun,
  mockCreateWorkflowRunLedger,
  mockResolveArn,
  mockEnsureBinding,
  mockCreateRun,
  mockMarkStarted,
  mockSfnSend,
  mockEnsureBlueprint,
} = vi.hoisted(() => ({
  mockRows: vi.fn(),
  mockAssertCanReadWorkflowTenant: vi.fn(),
  mockTriggerRoutineRun: vi.fn(),
  mockCreateWorkflowRunLedger: vi.fn(),
  mockResolveArn: vi.fn(),
  mockEnsureBinding: vi.fn(),
  mockCreateRun: vi.fn(),
  mockMarkStarted: vi.fn(),
  mockSfnSend: vi.fn(),
  mockEnsureBlueprint: vi.fn(async () => ({
    managed: false,
    published: false,
    versionId: null,
  })),
}));

vi.mock("@aws-sdk/client-sfn", () => ({
  SFNClient: vi.fn(() => ({ send: mockSfnSend })),
  StartExecutionCommand: vi.fn((input) => ({ input })),
}));

vi.mock("@thinkwork/database-pg", () => ({
  createInterpreterWorkflowRun: mockCreateRun,
  ensureInterpreterBinding: mockEnsureBinding,
  markInterpreterRunStarted: mockMarkStarted,
  ensureMemoryBlueprintVersion: mockEnsureBlueprint,
}));

vi.mock("../../../lib/workflows/interpreter-state-machine.js", () => ({
  resolveInterpreterStateMachineArn: mockResolveArn,
}));

vi.mock("../../utils.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(mockRows()),
        }),
      }),
    }),
  },
  snakeToCamel: (row: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      out[key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = value;
    }
    return out;
  },
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  workflowEngineBindings: {
    id: "workflow_engine_bindings.id",
    workflow_id: "workflow_engine_bindings.workflow_id",
    binding_type: "workflow_engine_bindings.binding_type",
    binding_status: "workflow_engine_bindings.binding_status",
    readiness_state: "workflow_engine_bindings.readiness_state",
    routine_id: "workflow_engine_bindings.routine_id",
  },
  workflowRuns: {
    id: "workflow_runs.id",
    tenant_id: "workflow_runs.tenant_id",
    workflow_id: "workflow_runs.workflow_id",
    idempotency_key: "workflow_runs.idempotency_key",
    backend_execution_id: "workflow_runs.backend_execution_id",
  },
  workflows: {
    id: "workflows.id",
  },
  agents: {
    id: "agents.id",
    tenant_id: "agents.tenant_id",
    is_platform_default: "agents.is_platform_default",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
}));

vi.mock("./types.js", () => ({
  assertCanReadWorkflowTenant: mockAssertCanReadWorkflowTenant,
}));

vi.mock("../routines/triggerRoutineRun.mutation.js", () => ({
  triggerRoutineRun: mockTriggerRoutineRun,
}));

vi.mock("../../../lib/workflows/run-ledger.js", () => ({
  createWorkflowRunLedger: mockCreateWorkflowRunLedger,
}));

let resolver: typeof import("./triggerWorkflowRun.mutation.js");

beforeEach(async () => {
  mockRows.mockReset();
  mockAssertCanReadWorkflowTenant.mockReset();
  mockTriggerRoutineRun.mockReset();
  mockCreateWorkflowRunLedger.mockReset();
  mockResolveArn.mockReset();
  mockEnsureBinding.mockReset();
  mockCreateRun.mockReset();
  mockMarkStarted.mockReset();
  mockSfnSend.mockReset();
  // Default: interpreter unavailable, so the legacy routine + blocked paths
  // run exactly as before this unit landed.
  mockResolveArn.mockResolvedValue(null);
  vi.resetModules();

  resolver = await import("./triggerWorkflowRun.mutation.js");
});

describe("triggerWorkflowRun", () => {
  it("delegates ready Step Functions routine workflows and returns the canonical workflow run", async () => {
    mockRows
      .mockReturnValueOnce([
        workflowRow({
          id: "workflow-1",
          tenant_id: "tenant-1",
          visibility: "agent_private",
          owner_agent_id: "agent-1",
          lifecycle_status: "active",
          readiness_state: "ready",
          readiness_reasons: [],
          capability_flags: { start: true, monitor: true },
        }),
      ])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([{ id: "binding-1", routine_id: "routine-1" }])
      .mockReturnValueOnce([
        {
          id: "run-1",
          tenant_id: "tenant-1",
          workflow_id: "workflow-1",
          status: "running",
          backend_execution_id: "arn:aws:states:execution",
        },
      ]);
    mockTriggerRoutineRun.mockResolvedValue({
      id: "routine-execution-1",
      sfnExecutionArn: "arn:aws:states:execution",
    });

    const result = await resolver.triggerWorkflowRun(
      null,
      {
        input: {
          workflowId: "workflow-1",
          agentId: "agent-1",
          input: JSON.stringify({ accountId: "acct-1" }),
          idempotencyKey: "retry-key",
        },
      },
      {
        auth: {
          tenantId: "tenant-1",
          agentId: "agent-1",
          principalId: null,
        },
      } as any,
    );

    expect(result).toMatchObject({
      id: "run-1",
      tenantId: "tenant-1",
      workflowId: "workflow-1",
      backendExecutionId: "arn:aws:states:execution",
    });
    expect(mockAssertCanReadWorkflowTenant).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-1",
    );
    expect(mockTriggerRoutineRun).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        routineId: "routine-1",
        input: { accountId: "acct-1" },
        triggerFamily: "agent",
        triggerSource: "workflow_contract",
        actorType: "agent",
        actorId: "agent-1",
        workflowRunIdempotencyKey: "retry-key",
      }),
      expect.anything(),
    );
  });

  it("prefers a ready interpreter binding and returns the started run", async () => {
    mockResolveArn.mockResolvedValue("arn:sm:interp");
    mockEnsureBinding.mockResolvedValue({
      id: "binding-interp",
      created: true,
    });
    mockCreateRun.mockResolvedValue({
      run: { id: "run-interp", status: "queued" },
      created: true,
    });
    mockSfnSend.mockResolvedValue({
      executionArn: "arn:aws:states:exec-interp",
      startDate: new Date("2026-07-07T00:00:00Z"),
    });
    mockRows
      .mockReturnValueOnce([
        workflowRow({
          id: "workflow-1",
          tenant_id: "tenant-1",
          name: "Nightly Digest",
          visibility: "tenant_shared",
          lifecycle_status: "active",
          current_version_id: "version-1",
          readiness_state: "ready",
          readiness_reasons: [],
          capability_flags: { start: true },
        }),
      ])
      .mockReturnValueOnce([{ id: "agent-platform" }]) // platform agent
      .mockReturnValueOnce([
        {
          id: "run-interp",
          tenant_id: "tenant-1",
          workflow_id: "workflow-1",
          status: "running",
          backend_execution_id: "arn:aws:states:exec-interp",
        },
      ]);

    const result = await resolver.triggerWorkflowRun(
      null,
      { input: { workflowId: "workflow-1" } },
      {
        auth: { tenantId: "tenant-1", agentId: null, principalId: "user-1" },
      } as any,
    );

    expect(result).toMatchObject({
      id: "run-interp",
      backendExecutionId: "arn:aws:states:exec-interp",
    });
    expect(mockCreateRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        triggerFamily: "manual",
        engineBindingId: "binding-interp",
        inputSummary: expect.objectContaining({
          agentId: "agent-platform",
          workflowName: "Nightly Digest",
        }),
      }),
    );
    expect(mockSfnSend).toHaveBeenCalledTimes(1);
    expect(mockSfnSend.mock.calls[0][0].input.name).toBe("run-run-interp-r0");
    expect(mockMarkStarted).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        runId: "run-interp",
        executionArn: "arn:aws:states:exec-interp",
      }),
    );
    // Legacy routine path must NOT run when the interpreter handled it.
    expect(mockTriggerRoutineRun).not.toHaveBeenCalled();
  });

  it("returns an existing idempotent workflow run before starting another backend execution", async () => {
    mockRows
      .mockReturnValueOnce([
        workflowRow({
          id: "workflow-1",
          tenant_id: "tenant-1",
          visibility: "tenant_shared",
          lifecycle_status: "active",
          readiness_state: "ready",
          readiness_reasons: [],
          capability_flags: { start: true },
        }),
      ])
      .mockReturnValueOnce([
        {
          id: "run-existing",
          tenant_id: "tenant-1",
          workflow_id: "workflow-1",
          idempotency_key: "retry-key",
          status: "running",
        },
      ]);

    const result = await resolver.triggerWorkflowRun(
      null,
      { input: { workflowId: "workflow-1", idempotencyKey: "retry-key" } },
      {
        auth: { tenantId: "tenant-1", agentId: null, principalId: "user-1" },
      } as any,
    );

    expect(result).toMatchObject({
      id: "run-existing",
      idempotencyKey: "retry-key",
    });
    expect(mockTriggerRoutineRun).not.toHaveBeenCalled();
  });

  it("records a blocked workflow run when no ready Step Functions binding exists", async () => {
    mockRows
      .mockReturnValueOnce([
        workflowRow({
          id: "workflow-1",
          tenant_id: "tenant-1",
          visibility: "tenant_shared",
          lifecycle_status: "active",
          current_version_id: "version-1",
          readiness_state: "ready",
          readiness_reasons: [],
          capability_flags: { start: true },
        }),
      ])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([
        {
          id: "blocked-run",
          tenant_id: "tenant-1",
          workflow_id: "workflow-1",
          status: "blocked_not_ready",
          readiness_snapshot: {
            state: "ready",
            reasons: [{ code: "no_ready_step_functions_binding" }],
          },
        },
      ]);
    mockCreateWorkflowRunLedger.mockResolvedValue({
      run: { id: "blocked-run" },
      created: true,
    });

    const result = await resolver.triggerWorkflowRun(
      null,
      { input: { workflowId: "workflow-1", input: { orderId: "o1" } } },
      {
        auth: { tenantId: "tenant-1", agentId: null, principalId: "user-1" },
      } as any,
    );

    expect(result).toMatchObject({
      id: "blocked-run",
      status: "blocked_not_ready",
    });
    expect(mockCreateWorkflowRunLedger).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: "tenant-1",
        workflowId: "workflow-1",
        workflowVersionId: "version-1",
        status: "blocked_not_ready",
        readinessSnapshot: expect.objectContaining({
          reasons: [
            expect.objectContaining({
              code: "no_ready_step_functions_binding",
            }),
          ],
        }),
      }),
    );
    expect(mockTriggerRoutineRun).not.toHaveBeenCalled();
  });
});

function workflowRow(
  overrides: Partial<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    id: "workflow-1",
    tenant_id: "tenant-1",
    visibility: "tenant_shared",
    owner_agent_id: null,
    lifecycle_status: "active",
    current_version_id: null,
    readiness_state: "ready",
    readiness_reasons: [],
    capability_flags: { start: true },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// THINK-193 U3: user ownership of personal (user-owned agent_private)
// workflows — user A cannot trigger user B's personal automation.
// ---------------------------------------------------------------------------

describe("triggerWorkflowRun — personal workflow ownership (U3)", () => {
  // apikey callers resolve userId = principalId without a db round-trip.
  const userCtx = (userId: string) =>
    ({
      auth: {
        authType: "apikey",
        tenantId: "tenant-1",
        agentId: null,
        principalId: userId,
      },
    }) as never;

  const personalWorkflow = () =>
    workflowRow({
      visibility: "agent_private",
      owner_agent_id: null,
      owner_user_id: "user-owner",
    });

  it("denies a NON-owner user before any run starts", async () => {
    mockRows.mockReturnValueOnce([personalWorkflow()]);

    await expect(
      resolver.triggerWorkflowRun(
        null,
        { input: { workflowId: "workflow-1" } },
        userCtx("user-intruder"),
      ),
    ).rejects.toThrow(/private_to_other_user/);
    expect(mockCreateRun).not.toHaveBeenCalled();
    expect(mockTriggerRoutineRun).not.toHaveBeenCalled();
    expect(mockCreateWorkflowRunLedger).not.toHaveBeenCalled();
  });

  it("allows the OWNER through the ownership gate", async () => {
    mockRows
      .mockReturnValueOnce([personalWorkflow()])
      // idempotency short-circuit: pretend the run already exists so the
      // test stops right after the ownership gate.
      .mockReturnValueOnce([{ id: "run-9", tenant_id: "tenant-1" }]);

    const result = await resolver.triggerWorkflowRun(
      null,
      { input: { workflowId: "workflow-1", idempotencyKey: "k-1" } },
      userCtx("user-owner"),
    );
    expect(result).toMatchObject({ id: "run-9" });
  });
});
