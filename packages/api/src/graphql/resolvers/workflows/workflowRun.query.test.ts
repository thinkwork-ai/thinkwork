import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRows = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();
const mockRequireTenantMember = vi.fn();
const mockResolveCallerTenantId = vi.fn();
const mockResolveCallerUserId = vi.fn();

vi.mock("../../utils.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: mockWhere,
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
  routineAslVersions: {
    id: "routine_asl_versions.id",
  },
  routines: {
    id: "routines.id",
  },
  workflowEngineBindings: {
    id: "workflow_engine_bindings.id",
    workflow_id: "workflow_engine_bindings.workflow_id",
    created_at: "workflow_engine_bindings.created_at",
  },
  workflowEvidence: {
    workflow_run_id: "workflow_evidence.workflow_run_id",
    created_at: "workflow_evidence.created_at",
  },
  workflowRunEvents: {
    workflow_run_id: "workflow_run_events.workflow_run_id",
    occurred_at: "workflow_run_events.occurred_at",
    created_at: "workflow_run_events.created_at",
  },
  workflowRuns: {
    id: "workflow_runs.id",
    tenant_id: "workflow_runs.tenant_id",
    workflow_id: "workflow_runs.workflow_id",
    status: "workflow_runs.status",
    created_at: "workflow_runs.created_at",
  },
  workflowTriggers: {
    workflow_id: "workflow_triggers.workflow_id",
    created_at: "workflow_triggers.created_at",
  },
  workflowVersions: {
    id: "workflow_versions.id",
  },
  workflows: {
    id: "workflows.id",
    tenant_id: "workflows.tenant_id",
    visibility: "workflows.visibility",
    owner_user_id: "workflows.owner_user_id",
    source_agent_loop_id: "workflows.source_agent_loop_id",
    updated_at: "workflows.updated_at",
  },
}));

vi.mock("../core/authz.js", () => ({
  requireTenantMember: mockRequireTenantMember,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: mockResolveCallerTenantId,
  resolveCallerUserId: mockResolveCallerUserId,
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  desc: (col: unknown) => ({ desc: col }),
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  inArray: (col: unknown, val: unknown) => ({ inArray: [col, val] }),
  isNull: (col: unknown) => ({ isNull: col }),
  lt: (col: unknown, val: unknown) => ({ lt: [col, val] }),
  ne: (col: unknown, val: unknown) => ({ ne: [col, val] }),
  or: (...args: unknown[]) => ({ or: args }),
}));

let workflowRunQuery: typeof import("./workflowRun.query.js");
let workflowRunsQuery: typeof import("./workflowRuns.query.js");
let workflowTypes: typeof import("./types.js");

beforeEach(async () => {
  mockRows.mockReset();
  mockWhere.mockReset();
  mockOrderBy.mockReset();
  mockLimit.mockReset();
  mockRequireTenantMember.mockReset();
  mockResolveCallerTenantId.mockReset();
  vi.resetModules();

  mockResolveCallerTenantId.mockResolvedValue(null);
  mockResolveCallerUserId.mockReset();
  mockResolveCallerUserId.mockResolvedValue("user-caller");
  mockLimit.mockImplementation(() => Promise.resolve(mockRows()));
  mockOrderBy.mockReturnValue({ limit: mockLimit });
  mockWhere.mockReturnValue({
    limit: mockLimit,
    orderBy: mockOrderBy,
  });

  workflowRunQuery = await import("./workflowRun.query.js");
  workflowRunsQuery = await import("./workflowRuns.query.js");
  workflowTypes = await import("./types.js");
});

describe("workflow run queries", () => {
  it("returns a single run with canonical trigger identity and ledger fields", async () => {
    mockRows.mockReturnValueOnce([
      {
        id: "run-1",
        tenant_id: "tenant-a",
        workflow_id: "workflow-1",
        workflow_version_id: "version-1",
        engine_binding_id: "binding-1",
        status: "running",
        trigger_family: "schedule",
        trigger_source: "scheduled_job",
        actor_type: "system",
        correlation_id: "corr-1",
        backend_execution_id: "arn:aws:states:execution",
        capability_snapshot: { cancel: true },
        readiness_snapshot: { state: "ready" },
      },
    ]);
    // U3 visibility check loads the parent workflow.
    mockRows.mockReturnValueOnce([
      {
        tenant_id: "tenant-a",
        visibility: "tenant_shared",
        owner_user_id: null,
      },
    ]);

    const result = await workflowRunQuery.workflowRun(null, { id: "run-1" }, {
      auth: { tenantId: "tenant-a" },
    } as any);

    expect(result).toEqual({
      id: "run-1",
      tenantId: "tenant-a",
      workflowId: "workflow-1",
      workflowVersionId: "version-1",
      engineBindingId: "binding-1",
      status: "running",
      triggerFamily: "schedule",
      triggerSource: "scheduled_job",
      actorType: "system",
      correlationId: "corr-1",
      backendExecutionId: "arn:aws:states:execution",
      capabilitySnapshot: { cancel: true },
      readinessSnapshot: { state: "ready" },
    });
    expect(mockRequireTenantMember).not.toHaveBeenCalled();
  });

  it("protects a run from non-tenant callers", async () => {
    mockRows.mockReturnValueOnce([
      {
        id: "run-1",
        tenant_id: "tenant-b",
        workflow_id: "workflow-1",
        status: "succeeded",
      },
    ]);
    mockResolveCallerTenantId.mockResolvedValue("tenant-a");
    mockRows.mockReturnValueOnce([
      {
        tenant_id: "tenant-b",
        visibility: "tenant_shared",
        owner_user_id: null,
      },
    ]);

    await workflowRunQuery.workflowRun(null, { id: "run-1" }, {
      auth: { tenantId: null },
    } as any);

    expect(mockRequireTenantMember).toHaveBeenCalledWith(
      { auth: { tenantId: null } },
      "tenant-b",
    );
  });

  it("lists runs for a workflow after checking the workflow tenant", async () => {
    mockRows
      .mockReturnValueOnce([{ tenant_id: "tenant-a" }])
      .mockReturnValueOnce([
        {
          id: "run-1",
          tenant_id: "tenant-a",
          workflow_id: "workflow-1",
          status: "succeeded",
        },
      ]);

    const result = await workflowRunsQuery.workflowRuns(
      null,
      { workflowId: "workflow-1", status: "succeeded", limit: 5 },
      { auth: { tenantId: "tenant-a" } } as any,
    );

    expect(result).toEqual([
      {
        id: "run-1",
        tenantId: "tenant-a",
        workflowId: "workflow-1",
        status: "succeeded",
      },
    ]);
    expect(mockWhere).toHaveBeenLastCalledWith({
      and: [
        { eq: ["workflow_runs.tenant_id", "tenant-a"] },
        { eq: ["workflow_runs.workflow_id", "workflow-1"] },
        { eq: ["workflow_runs.status", "succeeded"] },
      ],
    });
    expect(mockLimit).toHaveBeenCalledWith(5);
  });

  it("returns run events and evidence in stable detail order", async () => {
    mockRows
      .mockReturnValueOnce([
        {
          id: 1,
          workflow_run_id: "run-1",
          event_type: "started",
          provenance: "native_event",
          payload_summary: {},
        },
      ])
      .mockReturnValueOnce([
        {
          id: "evidence-1",
          workflow_run_id: "run-1",
          evidence_type: "step_functions_execution",
          source_system: "aws_step_functions",
          redaction_state: "summary_only",
        },
      ]);

    await expect(
      workflowTypes.workflowRunTypeResolvers.events({ id: "run-1" }),
    ).resolves.toEqual([
      {
        id: 1,
        workflowRunId: "run-1",
        eventType: "started",
        provenance: "native_event",
        payloadSummary: {},
      },
    ]);
    await expect(
      workflowTypes.workflowRunTypeResolvers.evidence({ id: "run-1" }),
    ).resolves.toEqual([
      {
        id: "evidence-1",
        workflowRunId: "run-1",
        evidenceType: "step_functions_execution",
        sourceSystem: "aws_step_functions",
        redactionState: "summary_only",
      },
    ]);
    expect(mockLimit).toHaveBeenCalledWith(1_000);
  });
});

// ---------------------------------------------------------------------------
// THINK-193 U3: runs of another user's personal automation read as absent.
// ---------------------------------------------------------------------------

describe("workflow run visibility (U3)", () => {
  it("returns null for a run whose workflow is another user's personal automation", async () => {
    mockRows
      .mockReturnValueOnce([
        {
          id: "run-p",
          tenant_id: "tenant-a",
          workflow_id: "wf-personal",
          status: "waiting_for_human",
        },
      ])
      .mockReturnValueOnce([
        { visibility: "agent_private", owner_user_id: "user-someone-else" },
      ]);

    const result = await workflowRunQuery.workflowRun(null, { id: "run-p" }, {
      auth: { tenantId: "tenant-a" },
    } as any);
    expect(result).toBeNull();
  });

  it("returns the run for its owner", async () => {
    mockRows
      .mockReturnValueOnce([
        {
          id: "run-p",
          tenant_id: "tenant-a",
          workflow_id: "wf-personal",
          status: "waiting_for_human",
        },
      ])
      .mockReturnValueOnce([
        { visibility: "agent_private", owner_user_id: "user-caller" },
      ]);

    const result = await workflowRunQuery.workflowRun(null, { id: "run-p" }, {
      auth: { tenantId: "tenant-a" },
    } as any);
    expect(result).toMatchObject({ id: "run-p" });
  });

  it("returns [] when listing runs of another user's personal workflow", async () => {
    mockRows.mockReturnValueOnce([
      {
        tenant_id: "tenant-a",
        visibility: "agent_private",
        owner_user_id: "user-someone-else",
      },
    ]);

    const result = await workflowRunsQuery.workflowRuns(
      null,
      { workflowId: "wf-personal" },
      { auth: { tenantId: "tenant-a" } } as any,
    );
    expect(result).toEqual([]);
  });

  it("filters tenant-wide run listings to workflows readable by the caller", async () => {
    mockRows.mockReturnValueOnce([
      {
        id: "run-own",
        tenant_id: "tenant-a",
        workflow_id: "wf-own",
      },
    ]);

    const result = await workflowRunsQuery.workflowRuns(
      null,
      { tenantId: "tenant-a" },
      { auth: { tenantId: "tenant-a" } } as any,
    );

    expect(result).toEqual([
      {
        id: "run-own",
        tenantId: "tenant-a",
        workflowId: "wf-own",
      },
    ]);
    expect(mockWhere).toHaveBeenNthCalledWith(1, {
      and: [
        { eq: ["workflows.tenant_id", "tenant-a"] },
        {
          or: [
            { ne: ["workflows.visibility", "agent_private"] },
            {
              and: [
                { isNull: "workflows.owner_user_id" },
                { isNull: "workflows.source_agent_loop_id" },
              ],
            },
            { eq: ["workflows.owner_user_id", "user-caller"] },
          ],
        },
      ],
    });
    expect(mockWhere).toHaveBeenNthCalledWith(2, {
      and: [
        { eq: ["workflow_runs.tenant_id", "tenant-a"] },
        {
          inArray: ["workflow_runs.workflow_id", expect.anything()],
        },
      ],
    });
  });
});
