import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRows = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();
const mockRequireTenantMember = vi.fn();
const mockResolveCallerTenantId = vi.fn();

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
  requireTenantMember: mockRequireTenantMember,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: mockResolveCallerTenantId,
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
  mockResolveCallerTenantId.mockReset();
  vi.resetModules();

  mockResolveCallerTenantId.mockResolvedValue(null);
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
});
