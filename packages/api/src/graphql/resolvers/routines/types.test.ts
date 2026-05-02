/**
 * RoutineExecution.aslVersion type-resolver tests.
 *
 * Schema-followups bundle (D U13 residual). The resolver matches an
 * execution to its routine_asl_versions row by routine_asl_version_id
 * first, then by (state_machine_arn, version_arn) for older rows.
 * Tests exercise both lookups, null fallbacks for missing arns, and
 * row-not-found paths for out-of-band executions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSelectFromWhereLimit = vi.fn();

vi.mock("../../utils.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: mockSelectFromWhereLimit,
        }),
      }),
    }),
  },
  snakeToCamel: <T>(row: T): T => row,
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  routineAslVersions: {
    id: "routine_asl_versions.id",
    state_machine_arn: "state_machine_arn",
    version_arn: "version_arn",
  },
  routineStepEvents: {
    execution_id: "execution_id",
    started_at: "started_at",
    created_at: "created_at",
  },
  routines: {
    id: "routines.id",
  },
  scheduledJobs: {
    id: "scheduled_jobs.id",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (col: unknown, val: unknown) => ({ col, val }),
}));

const ARN_BASE = "arn:aws:states:us-east-1:123:stateMachine:tenant-routine";
const VERSION_ARN_1 = `${ARN_BASE}:1`;

let resolvers: typeof import("./types.js").routineExecutionTypeResolvers;

beforeEach(async () => {
  mockSelectFromWhereLimit.mockReset();
  vi.resetModules();
  resolvers = (await import("./types.js")).routineExecutionTypeResolvers;
});

describe("RoutineExecution.aslVersion resolver", () => {
  it("queries by routineAslVersionId before falling back to version ARN", async () => {
    const fakeRow = {
      id: "v1-id",
      state_machine_arn: ARN_BASE,
      version_arn: VERSION_ARN_1,
      version_number: 1,
      step_manifest_json: { Step1: { recipeType: "python" } },
      markdown_summary: "# Routine",
    };
    mockSelectFromWhereLimit.mockResolvedValueOnce([fakeRow]);

    const result = await resolvers.aslVersion(
      {
        routineAslVersionId: "v1-id",
        stateMachineArn: ARN_BASE,
        versionArn: null,
      } as any,
      undefined,
      {} as any,
    );

    expect(result).toEqual(fakeRow);
    expect(mockSelectFromWhereLimit).toHaveBeenCalledOnce();
  });

  it("returns null when stateMachineArn is missing", async () => {
    const result = await resolvers.aslVersion(
      { versionArn: VERSION_ARN_1 } as any,
      undefined,
      {} as any,
    );
    expect(result).toBeNull();
    expect(mockSelectFromWhereLimit).not.toHaveBeenCalled();
  });

  it("returns null when versionArn is missing and no ASL version id is present", async () => {
    const result = await resolvers.aslVersion(
      { stateMachineArn: ARN_BASE, versionArn: null } as any,
      undefined,
      {} as any,
    );
    expect(result).toBeNull();
    expect(mockSelectFromWhereLimit).not.toHaveBeenCalled();
  });

  it("returns null when ASL version id is missing and versionArn is missing", async () => {
    mockSelectFromWhereLimit.mockResolvedValueOnce([]);

    const result = await resolvers.aslVersion(
      {
        routineAslVersionId: "missing-version-id",
        stateMachineArn: ARN_BASE,
        versionArn: null,
      } as any,
      undefined,
      {} as any,
    );
    expect(result).toBeNull();
    expect(mockSelectFromWhereLimit).toHaveBeenCalledOnce();
  });

  it("falls back to version ARN when ASL version id lookup misses", async () => {
    const fakeRow = {
      id: "v1-id",
      state_machine_arn: ARN_BASE,
      version_arn: VERSION_ARN_1,
      version_number: 1,
      step_manifest_json: { Step1: { recipeType: "python" } },
      markdown_summary: "# Routine",
    };
    mockSelectFromWhereLimit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([fakeRow]);

    const result = await resolvers.aslVersion(
      {
        routineAslVersionId: "missing-version-id",
        stateMachineArn: ARN_BASE,
        versionArn: VERSION_ARN_1,
      } as any,
      undefined,
      {} as any,
    );

    expect(result).toEqual(fakeRow);
    expect(mockSelectFromWhereLimit).toHaveBeenCalledTimes(2);
  });

  it("queries by (stateMachineArn, versionArn) and returns the matching row", async () => {
    const fakeRow = {
      id: "v1-id",
      state_machine_arn: ARN_BASE,
      version_arn: VERSION_ARN_1,
      version_number: 1,
      step_manifest_json: { Step1: { recipeType: "python" } },
      markdown_summary: "# Routine",
    };
    mockSelectFromWhereLimit.mockResolvedValueOnce([fakeRow]);
    const result = await resolvers.aslVersion(
      { stateMachineArn: ARN_BASE, versionArn: VERSION_ARN_1 } as any,
      undefined,
      {} as any,
    );
    expect(result).toEqual(fakeRow);
    expect(mockSelectFromWhereLimit).toHaveBeenCalledOnce();
  });

  it("returns null when no row matches the (stateMachineArn, versionArn) pair", async () => {
    mockSelectFromWhereLimit.mockResolvedValueOnce([]);
    const result = await resolvers.aslVersion(
      { stateMachineArn: ARN_BASE, versionArn: VERSION_ARN_1 } as any,
      undefined,
      {} as any,
    );
    expect(result).toBeNull();
  });
});
