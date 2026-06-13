import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteReturning: vi.fn(),
  deleteRows: [] as Array<Record<string, unknown>>,
  requireAdminOrServiceCaller: vi.fn(),
  selectRows: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../utils.js", () => ({
  db: {
    delete: () => ({
      where: () => ({
        returning: mocks.deleteReturning,
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => mocks.selectRows,
        }),
      }),
    }),
  },
  budgetPolicies: {
    id: "budget_policies.id",
    tenant_id: "budget_policies.tenant_id",
  },
  eq: (...args: unknown[]) => ({ _eq: args }),
}));
vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: mocks.requireAdminOrServiceCaller,
}));

// eslint-disable-next-line import/first
import { deleteBudgetPolicy } from "./deleteBudgetPolicy.mutation.js";

beforeEach(() => {
  mocks.deleteReturning.mockReset();
  mocks.deleteReturning.mockImplementation(async () => mocks.deleteRows);
  mocks.deleteRows = [];
  mocks.requireAdminOrServiceCaller.mockReset();
  mocks.requireAdminOrServiceCaller.mockResolvedValue(undefined);
  mocks.selectRows = [];
});

function cognitoCtx(): any {
  return { auth: { authType: "cognito" } };
}

describe("deleteBudgetPolicy", () => {
  it("returns false without authorizing when the policy does not exist", async () => {
    await expect(
      deleteBudgetPolicy(null, { id: "missing-policy" }, cognitoCtx()),
    ).resolves.toBe(false);

    expect(mocks.requireAdminOrServiceCaller).not.toHaveBeenCalled();
  });

  it("authorizes against the policy tenant before deleting", async () => {
    mocks.selectRows = [{ tenant_id: "tenant-1" }];
    mocks.deleteRows = [{ id: "policy-1" }];

    await expect(
      deleteBudgetPolicy(null, { id: "policy-1" }, cognitoCtx()),
    ).resolves.toBe(true);

    expect(mocks.requireAdminOrServiceCaller).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-1",
      "budget_policy:delete",
    );
    expect(mocks.deleteReturning).toHaveBeenCalledTimes(1);
  });

  it("does not delete when the admin gate rejects", async () => {
    mocks.selectRows = [{ tenant_id: "tenant-1" }];
    mocks.deleteRows = [{ id: "policy-1" }];
    mocks.requireAdminOrServiceCaller.mockRejectedValue(
      Object.assign(new Error("Tenant admin role required"), {
        extensions: { code: "FORBIDDEN" },
      }),
    );

    await expect(
      deleteBudgetPolicy(null, { id: "policy-1" }, cognitoCtx()),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(mocks.deleteReturning).not.toHaveBeenCalled();
  });
});
