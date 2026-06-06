import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Array<Record<string, unknown>>>,
  budgetStatusForPolicy: vi.fn(),
}));

function queryChain() {
  const rows = () => Promise.resolve(mocks.rows.shift() ?? []);
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => rows(),
  };
  return chain;
}

vi.mock("../../utils.js", () => ({
  db: {
    select: () => queryChain(),
  },
  budgetPolicies: {
    tenant_id: "budget_policies.tenant_id",
    scope: "budget_policies.scope",
    user_id: "budget_policies.user_id",
    enabled: "budget_policies.enabled",
  },
  users: {
    id: "users.id",
    tenant_id: "users.tenant_id",
  },
  and: (...args: unknown[]) => ({ _and: args }),
  eq: (...args: unknown[]) => ({ _eq: args }),
}));

vi.mock("./budgetStatus.query.js", () => ({
  budgetStatusForPolicy: mocks.budgetStatusForPolicy,
}));

// eslint-disable-next-line import/first
import { userBudgetStatus } from "./userBudgetStatus.query.js";

beforeEach(() => {
  mocks.rows = [];
  mocks.budgetStatusForPolicy.mockReset();
});

describe("userBudgetStatus", () => {
  it("rejects users outside the tenant", async () => {
    mocks.rows = [[]];

    await expect(
      userBudgetStatus(
        null,
        { tenantId: "tenant-1", userId: "user-2" },
        {} as any,
      ),
    ).rejects.toThrow("User not found in tenant");
  });

  it("returns null when the tenant user has no enabled user policy", async () => {
    mocks.rows = [[{ id: "user-1" }], []];

    await expect(
      userBudgetStatus(
        null,
        { tenantId: "tenant-1", userId: "user-1" },
        {} as any,
      ),
    ).resolves.toBeNull();
    expect(mocks.budgetStatusForPolicy).not.toHaveBeenCalled();
  });

  it("delegates user policy spend calculation to budgetStatusForPolicy", async () => {
    const policy = {
      id: "policy-1",
      tenant_id: "tenant-1",
      scope: "user",
      user_id: "user-1",
    };
    mocks.rows = [[{ id: "user-1" }], [policy]];
    mocks.budgetStatusForPolicy.mockResolvedValue({
      spentUsd: 12,
      status: "normal",
    });

    await expect(
      userBudgetStatus(
        null,
        { tenantId: "tenant-1", userId: "user-1" },
        {} as any,
      ),
    ).resolves.toEqual({ spentUsd: 12, status: "normal" });
    expect(mocks.budgetStatusForPolicy).toHaveBeenCalledWith(
      policy,
      "tenant-1",
    );
  });
});
