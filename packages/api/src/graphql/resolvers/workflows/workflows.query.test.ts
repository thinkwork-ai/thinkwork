import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRows = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();
const mockRequireTenantMember = vi.fn();
const mockRequireAdminOrServiceCaller = vi.fn();
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
  agentLoops: {
    id: "agent_loops.id",
    tenant_id: "agent_loops.tenant_id",
  },
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
    lifecycle_status: "workflows.lifecycle_status",
    readiness_state: "workflows.readiness_state",
    updated_at: "workflows.updated_at",
  },
}));

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: mockRequireAdminOrServiceCaller,
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
  lt: (col: unknown, val: unknown) => ({ lt: [col, val] }),
}));

let workflowQueries: typeof import("./workflows.query.js");
let workflowTypes: typeof import("./types.js");

beforeEach(async () => {
  mockRows.mockReset();
  mockWhere.mockReset();
  mockOrderBy.mockReset();
  mockLimit.mockReset();
  mockRequireTenantMember.mockReset();
  mockRequireAdminOrServiceCaller.mockReset();
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

  workflowQueries = await import("./workflows.query.js");
  workflowTypes = await import("./types.js");
});

describe("workflow queries", () => {
  it("lists tenant workflows with readiness and lifecycle filters", async () => {
    mockRows.mockReturnValueOnce([
      {
        id: "workflow-1",
        tenant_id: "tenant-a",
        name: "Onboard customer",
        slug: "onboard-customer",
        lifecycle_status: "active",
        primary_trigger_family: "manual",
        readiness_state: "ready",
        readiness_reasons: [],
        capability_flags: { retry: true },
      },
    ]);

    const result = await workflowQueries.workflows(
      null,
      {
        tenantId: "tenant-a",
        lifecycleStatus: "active",
        readinessState: "ready",
        limit: 10,
      },
      { auth: { tenantId: "tenant-a" } } as any,
    );

    expect(result).toEqual([
      {
        id: "workflow-1",
        tenantId: "tenant-a",
        name: "Onboard customer",
        slug: "onboard-customer",
        lifecycleStatus: "active",
        primaryTriggerFamily: "manual",
        readinessState: "ready",
        readinessReasons: [],
        capabilityFlags: { retry: true },
      },
    ]);
    expect(mockWhere).toHaveBeenCalledWith({
      and: [
        { eq: ["workflows.tenant_id", "tenant-a"] },
        { eq: ["workflows.lifecycle_status", "active"] },
        { eq: ["workflows.readiness_state", "ready"] },
      ],
    });
    expect(mockOrderBy).toHaveBeenCalledWith({ desc: "workflows.updated_at" });
    expect(mockLimit).toHaveBeenCalledWith(10);
    expect(mockRequireTenantMember).not.toHaveBeenCalled();
  });

  it("authorizes requested tenants outside the caller tenant", async () => {
    mockRows.mockReturnValueOnce([]);
    mockResolveCallerTenantId.mockResolvedValue("tenant-a");

    await workflowQueries.workflows(null, { tenantId: "tenant-b" }, {
      auth: { tenantId: null },
    } as any);

    expect(mockRequireTenantMember).toHaveBeenCalledWith(
      { auth: { tenantId: null } },
      "tenant-b",
    );
  });

  it("returns every owner's private workflows only through the admin-gated operator scope", async () => {
    mockRows.mockReturnValueOnce([
      {
        id: "wf-own",
        visibility: "agent_private",
        owner_user_id: "user-caller",
      },
      {
        id: "wf-other",
        visibility: "agent_private",
        owner_user_id: "user-other",
      },
    ]);

    const result = (await workflowQueries.workflows(
      null,
      { tenantId: "tenant-a", scope: "OPERATOR" },
      {
        auth: {
          authType: "cognito",
          tenantId: "tenant-a",
        },
      } as any,
    )) as Array<{ id: string }>;

    expect(mockRequireAdminOrServiceCaller).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-a",
      "read_workflow",
    );
    expect(result.map((row) => row.id)).toEqual(["wf-own", "wf-other"]);
  });

  it("projects readiness-blocked Step Functions routine bindings", async () => {
    mockRows.mockReturnValueOnce([
      {
        id: "binding-1",
        tenant_id: "tenant-a",
        workflow_id: "workflow-1",
        binding_type: "step_functions_routine",
        binding_status: "blocked_not_ready",
        routine_id: "routine-1",
        capability_flags: { retry: false },
        readiness_state: "blocked_not_ready",
        readiness_reasons: [{ code: "missing_alias" }],
      },
    ]);

    const result = await workflowTypes.workflowTypeResolvers.bindings({
      id: "workflow-1",
    });

    expect(result).toEqual([
      {
        id: "binding-1",
        tenantId: "tenant-a",
        workflowId: "workflow-1",
        bindingType: "step_functions_routine",
        bindingStatus: "blocked_not_ready",
        routineId: "routine-1",
        capabilityFlags: { retry: false },
        readinessState: "blocked_not_ready",
        readinessReasons: [{ code: "missing_alias" }],
      },
    ]);
    expect(mockWhere).toHaveBeenCalledWith({
      eq: ["workflow_engine_bindings.workflow_id", "workflow-1"],
    });
    expect(mockLimit).toHaveBeenCalledWith(1_000);
  });

  it("resolves a source Automation by immutable id and tenant", async () => {
    mockRows.mockReturnValueOnce([
      {
        id: "loop-1",
        tenant_id: "tenant-a",
        name: "Daily sales review",
      },
    ]);

    const result = await workflowTypes.workflowTypeResolvers.sourceAutomation(
      {
        id: "workflow-1",
        tenantId: "tenant-a",
        sourceAgentLoopId: "loop-1",
      },
      {},
      { auth: { tenantId: "tenant-a" } } as any,
    );

    expect(result).toEqual({
      id: "loop-1",
      tenantId: "tenant-a",
      name: "Daily sales review",
    });
    expect(mockRequireAdminOrServiceCaller).toHaveBeenCalledWith(
      { auth: { tenantId: "tenant-a" } },
      "tenant-a",
      "read_agent_loop",
    );
    expect(mockWhere).toHaveBeenCalledWith({
      and: [
        { eq: ["agent_loops.id", "loop-1"] },
        { eq: ["agent_loops.tenant_id", "tenant-a"] },
      ],
    });
  });

  it("returns null when a Workflow has no source Automation", async () => {
    const result = await workflowTypes.workflowTypeResolvers.sourceAutomation(
      { id: "workflow-1", tenantId: "tenant-a" },
      {},
      { auth: { tenantId: "tenant-a" } } as any,
    );

    expect(result).toBeNull();
    expect(mockRequireAdminOrServiceCaller).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// THINK-193 U3: another user's personal (user-owned agent_private) workflow
// never appears in the tenant list.
// ---------------------------------------------------------------------------

describe("workflow list visibility (U3)", () => {
  it("hides other users' personal workflows and keeps own + shared + agent-owned", async () => {
    mockRows.mockReturnValueOnce([
      { id: "wf-shared", visibility: "tenant_shared", owner_user_id: null },
      {
        id: "wf-own-personal",
        visibility: "agent_private",
        owner_user_id: "user-caller",
      },
      {
        id: "wf-other-personal",
        visibility: "agent_private",
        owner_user_id: "user-someone-else",
      },
      {
        id: "wf-agent-owned",
        visibility: "agent_private",
        owner_user_id: null,
        owner_agent_id: "agent-1",
      },
    ]);

    const result = (await workflowQueries.workflows(
      null,
      { tenantId: "tenant-a" },
      { auth: { tenantId: "tenant-a" } } as any,
    )) as Array<{ id: string }>;

    expect(result.map((row) => row.id)).toEqual([
      "wf-shared",
      "wf-own-personal",
      "wf-agent-owned",
    ]);
  });
});
