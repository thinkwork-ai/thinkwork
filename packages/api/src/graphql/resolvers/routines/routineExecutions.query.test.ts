/**
 * Routine execution query resolver tests.
 *
 * Covers the read path the admin Test button depends on after
 * triggerRoutineRun inserts a routine_executions row.
 */

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
  routineAslVersions: {
    id: "routine_asl_versions.id",
    tenant_id: "routine_asl_versions.tenant_id",
  },
  routineExecutions: {
    id: "routine_executions.id",
    tenant_id: "routine_executions.tenant_id",
    routine_id: "routine_executions.routine_id",
    status: "routine_executions.status",
    started_at: "routine_executions.started_at",
  },
  routineStepEvents: {
    execution_id: "routine_step_events.execution_id",
    started_at: "routine_step_events.started_at",
    created_at: "routine_step_events.created_at",
  },
  routines: {
    id: "routines.id",
    tenant_id: "routines.tenant_id",
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

let resolvers: typeof import("./routineExecutions.query.js");

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

  resolvers = await import("./routineExecutions.query.js");
});

describe("routine execution queries", () => {
  it("lists executions for a routine newest-first and lowercases enum filters", async () => {
    mockRows
      .mockReturnValueOnce([{ tenant_id: "tenant-a" }])
      .mockReturnValueOnce([
        {
          id: "exec-1",
          tenant_id: "tenant-a",
          routine_id: "routine-a",
          trigger_source: "manual",
          status: "running",
        },
      ]);

    const result = await resolvers.routineExecutions(
      null,
      { routineId: "routine-a", status: "RUNNING", limit: 10 },
      {} as any,
    );

    expect(result).toEqual([
      {
        id: "exec-1",
        tenantId: "tenant-a",
        routineId: "routine-a",
        triggerSource: "manual",
        status: "running",
      },
    ]);
    expect(mockWhere).toHaveBeenCalledWith({
      and: [
        { eq: ["routine_executions.tenant_id", "tenant-a"] },
        { eq: ["routine_executions.routine_id", "routine-a"] },
        { eq: ["routine_executions.status", "running"] },
      ],
    });
    expect(mockRequireTenantMember).toHaveBeenCalledWith({}, "tenant-a");
    expect(mockOrderBy).toHaveBeenCalledWith({
      desc: "routine_executions.started_at",
    });
    expect(mockLimit).toHaveBeenCalledWith(10);
  });

  it("returns null when a single execution is not found", async () => {
    mockRows.mockReturnValueOnce([]);

    await expect(
      resolvers.routineExecution(null, { id: "missing" }, {} as any),
    ).resolves.toBeNull();
  });

  it("returns ordered step events for an execution", async () => {
    mockRows
      .mockReturnValueOnce([{ tenant_id: "tenant-a" }])
      .mockReturnValueOnce([
        {
          id: 1,
          execution_id: "exec-1",
          node_id: "Done",
          recipe_type: "succeed",
        },
      ]);

    const result = await resolvers.routineStepEvents_(
      null,
      { executionId: "exec-1" },
      {} as any,
    );

    expect(result).toEqual([
      {
        id: 1,
        executionId: "exec-1",
        nodeId: "Done",
        recipeType: "succeed",
      },
    ]);
    expect(mockLimit).toHaveBeenCalledWith(1_000);
  });
});
