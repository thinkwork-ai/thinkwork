import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRows = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();
const mockRequireTenantMember = vi.fn();

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
  systemWorkflowConfigs: {
    tenant_id: "system_workflow_configs.tenant_id",
    workflow_id: "system_workflow_configs.workflow_id",
    status: "system_workflow_configs.status",
    version_number: "system_workflow_configs.version_number",
  },
  systemWorkflowEvidence: {
    run_id: "system_workflow_evidence.run_id",
    created_at: "system_workflow_evidence.created_at",
  },
  systemWorkflowExtensionBindings: {
    tenant_id: "system_workflow_extension_bindings.tenant_id",
    workflow_id: "system_workflow_extension_bindings.workflow_id",
    created_at: "system_workflow_extension_bindings.created_at",
  },
  systemWorkflowRuns: {
    id: "system_workflow_runs.id",
    tenant_id: "system_workflow_runs.tenant_id",
    workflow_id: "system_workflow_runs.workflow_id",
    status: "system_workflow_runs.status",
    started_at: "system_workflow_runs.started_at",
    created_at: "system_workflow_runs.created_at",
  },
  systemWorkflowStepEvents: {
    run_id: "system_workflow_step_events.run_id",
    started_at: "system_workflow_step_events.started_at",
    created_at: "system_workflow_step_events.created_at",
  },
}));

vi.mock("../core/authz.js", () => ({
  requireTenantMember: mockRequireTenantMember,
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  desc: (col: unknown) => ({ desc: col }),
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  lt: (col: unknown, val: unknown) => ({ lt: [col, val] }),
}));

let resolvers: typeof import("./queries.js");

beforeEach(async () => {
  mockRows.mockReset();
  mockWhere.mockReset();
  mockOrderBy.mockReset();
  mockLimit.mockReset();
  mockRequireTenantMember.mockReset();
  vi.resetModules();

  mockLimit.mockImplementation(() => Promise.resolve(mockRows()));
  mockOrderBy.mockReturnValue({ limit: mockLimit });
  mockWhere.mockReturnValue({
    limit: mockLimit,
    orderBy: mockOrderBy,
  });

  resolvers = await import("./queries.js");
});

describe("system workflow queries", () => {
  it("lists registry workflows with tenant latest-run and config annotations", async () => {
    mockRows
      .mockReturnValueOnce([
        {
          id: "run-1",
          tenant_id: "tenant-a",
          workflow_id: "evaluation-runs",
          status: "succeeded",
          evidence_summary_json: { scoreSummary: true },
        },
      ])
      .mockReturnValueOnce([
        {
          id: "config-1",
          tenant_id: "tenant-a",
          workflow_id: "evaluation-runs",
          version_number: 2,
          status: "active",
          config_json: { passRateThreshold: 0.95 },
        },
      ]);

    const result = await resolvers.systemWorkflows(
      null,
      { tenantId: "tenant-a" },
      {} as any,
    );

    const evalWorkflow = result.find(
      (workflow) => workflow.id === "evaluation-runs",
    );
    expect(result).toHaveLength(3);
    expect(evalWorkflow).toMatchObject({
      id: "evaluation-runs",
      tenantId: "tenant-a",
      customizationStatus: "customized",
      evidenceStatus: "available",
    });
    expect(mockRequireTenantMember).toHaveBeenCalledWith({}, "tenant-a");
  });

  it("filters runs by workflow and lowercases GraphQL status enums", async () => {
    mockRows.mockReturnValueOnce([
      {
        id: "run-1",
        tenant_id: "tenant-a",
        workflow_id: "wiki-build",
        status: "running",
      },
    ]);

    const result = await resolvers.systemWorkflowRuns(
      null,
      {
        tenantId: "tenant-a",
        workflowId: "wiki-build",
        status: "RUNNING",
        limit: 10,
      },
      {} as any,
    );

    expect(result).toEqual([
      {
        id: "run-1",
        tenantId: "tenant-a",
        workflowId: "wiki-build",
        status: "running",
      },
    ]);
    expect(mockWhere).toHaveBeenCalledWith({
      and: [
        { eq: ["system_workflow_runs.tenant_id", "tenant-a"] },
        { eq: ["system_workflow_runs.workflow_id", "wiki-build"] },
        { eq: ["system_workflow_runs.status", "running"] },
      ],
    });
  });
});
