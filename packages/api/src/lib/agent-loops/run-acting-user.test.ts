import { describe, expect, it, vi } from "vitest";
import {
  resolveRunActingUserId,
  type RunActingUserQueries,
} from "./run-acting-user.js";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const TURN_ID = "33333333-3333-3333-3333-333333333333";
const RUN_AS_USER_ID = "88888888-8888-8888-8888-888888888888";

function makeQueries(
  overrides: Partial<RunActingUserQueries> = {},
): RunActingUserQueries {
  return {
    findRunAsUserForTurn: vi.fn(async () => RUN_AS_USER_ID),
    isActiveTenantMember: vi.fn(async () => true),
    ...overrides,
  };
}

describe("resolveRunActingUserId (THINK-155 U1)", () => {
  it("returns the run-as user when linked and an active tenant member", async () => {
    const queries = makeQueries();
    const result = await resolveRunActingUserId(
      { tenantId: TENANT_ID, turnId: TURN_ID },
      queries,
    );
    expect(result).toBe(RUN_AS_USER_ID);
    expect(queries.findRunAsUserForTurn).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      turnId: TURN_ID,
    });
    expect(queries.isActiveTenantMember).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      userId: RUN_AS_USER_ID,
    });
  });

  it("returns null when the turn has no run linkage", async () => {
    const queries = makeQueries({
      findRunAsUserForTurn: vi.fn(async () => null),
    });
    const result = await resolveRunActingUserId(
      { tenantId: TENANT_ID, turnId: TURN_ID },
      queries,
    );
    expect(result).toBeNull();
    expect(queries.isActiveTenantMember).not.toHaveBeenCalled();
  });

  it("returns null when the run-as user fails the tenant-membership cross-check", async () => {
    const queries = makeQueries({
      isActiveTenantMember: vi.fn(async () => false),
    });
    const result = await resolveRunActingUserId(
      { tenantId: TENANT_ID, turnId: TURN_ID },
      queries,
    );
    expect(result).toBeNull();
  });
});
