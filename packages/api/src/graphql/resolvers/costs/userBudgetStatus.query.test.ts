import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Array<Record<string, unknown>>>,
  budgetStatusForPolicy: vi.fn(),
  requireAdminOrServiceCaller: vi.fn(),
  resolveCaller: vi.fn(),
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
vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: mocks.requireAdminOrServiceCaller,
}));
vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCaller: mocks.resolveCaller,
}));

// eslint-disable-next-line import/first
import { userBudgetStatus } from "./userBudgetStatus.query.js";

beforeEach(() => {
  mocks.rows = [];
  mocks.budgetStatusForPolicy.mockReset();
  mocks.requireAdminOrServiceCaller.mockReset();
  mocks.resolveCaller.mockReset();
  mocks.requireAdminOrServiceCaller.mockResolvedValue(undefined);
  mocks.resolveCaller.mockResolvedValue({
    userId: "user-1",
    tenantId: "tenant-1",
  });
});

function cognitoCtx(): any {
  return { auth: { authType: "cognito" } };
}

describe("userBudgetStatus", () => {
  it("rejects the caller's own user id when it is outside the requested tenant", async () => {
    mocks.rows = [[]];

    await expect(
      userBudgetStatus(
        null,
        { tenantId: "tenant-2", userId: "user-1" },
        cognitoCtx(),
      ),
    ).rejects.toThrow("User not found in tenant");
    expect(mocks.requireAdminOrServiceCaller).not.toHaveBeenCalled();
  });

  it("returns null when the tenant user has no enabled user policy", async () => {
    mocks.rows = [[{ id: "user-1" }], []];

    await expect(
      userBudgetStatus(
        null,
        { tenantId: "tenant-1", userId: "user-1" },
        cognitoCtx(),
      ),
    ).resolves.toBeNull();
    expect(mocks.budgetStatusForPolicy).not.toHaveBeenCalled();
    expect(mocks.requireAdminOrServiceCaller).not.toHaveBeenCalled();
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
        cognitoCtx(),
      ),
    ).resolves.toEqual({ spentUsd: 12, status: "normal" });
    expect(mocks.budgetStatusForPolicy).toHaveBeenCalledWith(
      policy,
      "tenant-1",
    );
    expect(mocks.requireAdminOrServiceCaller).not.toHaveBeenCalled();
  });

  it("requires admin or service auth for another user's budget status", async () => {
    mocks.rows = [[{ id: "user-2" }], []];
    mocks.resolveCaller.mockResolvedValue({
      userId: "user-1",
      tenantId: "tenant-1",
    });

    await expect(
      userBudgetStatus(
        null,
        { tenantId: "tenant-1", userId: "user-2" },
        cognitoCtx(),
      ),
    ).resolves.toBeNull();

    expect(mocks.requireAdminOrServiceCaller).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-1",
      "budget_policy:read",
    );
  });

  it("rejects another user's budget status when the admin gate rejects", async () => {
    mocks.rows = [];
    mocks.resolveCaller.mockResolvedValue({
      userId: "user-1",
      tenantId: "tenant-1",
    });
    mocks.requireAdminOrServiceCaller.mockRejectedValue(
      Object.assign(new Error("Tenant admin role required"), {
        extensions: { code: "FORBIDDEN" },
      }),
    );

    await expect(
      userBudgetStatus(
        null,
        { tenantId: "tenant-1", userId: "user-2" },
        cognitoCtx(),
      ),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });

    expect(mocks.budgetStatusForPolicy).not.toHaveBeenCalled();
  });
});
