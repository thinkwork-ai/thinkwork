/**
 * RoutineExecution.aslVersion type-resolver tests.
 *
 * Schema-followups bundle (D U13 residual). The resolver matches an
 * execution to its routine_asl_versions row by (state_machine_arn,
 * version_arn). Tests exercise the lookup, the null fallbacks for
 * missing arns, and the row-not-found path for out-of-band executions.
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
  snakeToCamel: <T,>(row: T): T => row,
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  routineAslVersions: {
    state_machine_arn: "state_machine_arn",
    version_arn: "version_arn",
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
  it("returns null when stateMachineArn is missing", async () => {
    const result = await resolvers.aslVersion(
      { versionArn: VERSION_ARN_1 } as any,
      undefined,
      {} as any,
    );
    expect(result).toBeNull();
    expect(mockSelectFromWhereLimit).not.toHaveBeenCalled();
  });

  it("returns null when versionArn is missing (out-of-band execution)", async () => {
    const result = await resolvers.aslVersion(
      { stateMachineArn: ARN_BASE, versionArn: null } as any,
      undefined,
      {} as any,
    );
    expect(result).toBeNull();
    expect(mockSelectFromWhereLimit).not.toHaveBeenCalled();
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
