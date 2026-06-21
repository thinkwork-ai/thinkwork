import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRows,
  mockAssertCanReadWorkflowTenant,
  mockTriggerRoutineRun,
  mockCreateWorkflowRunLedger,
} = vi.hoisted(() => ({
  mockRows: vi.fn(),
  mockAssertCanReadWorkflowTenant: vi.fn(),
  mockTriggerRoutineRun: vi.fn(),
  mockCreateWorkflowRunLedger: vi.fn(),
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
