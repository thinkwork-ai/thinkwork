import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectRows: [] as Array<Array<Record<string, unknown>>>,
  insertValues: vi.fn(),
  requireAdminOrServiceCaller: vi.fn(),
  updateSet: vi.fn(),
}));

function selectChain() {
  const rows = () => Promise.resolve(mocks.selectRows.shift() ?? []);
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => rows(),
    then: (
      resolve: (value: Array<Record<string, unknown>>) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => rows().then(resolve, reject),
  };
  return chain;
}

function snakeToCamel(row: Record<string, unknown>) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentId: row.agent_id ?? null,
    userId: row.user_id ?? null,
    scope: row.scope,
    period: row.period,
    limitUsd: Number(row.limit_usd),
    actionOnExceed: row.action_on_exceed,
    enabled: row.enabled ?? true,
  };
}

vi.mock("../../utils.js", () => ({
  db: {
    select: () => selectChain(),
    insert: () => ({
      values: (value: Record<string, unknown>) => {
        mocks.insertValues(value);
        return {
          returning: async () => [{ id: "policy-1", ...value, enabled: true }],
        };
      },
    }),
    update: () => ({
      set: (value: Record<string, unknown>) => {
        mocks.updateSet(value);
        return {
          where: () => ({
            returning: async () => [
              {
                id: "policy-existing",
                tenant_id: "tenant-1",
                user_id: "user-1",
                scope: "user",
                ...value,
              },
            ],
          }),
        };
      },
    }),
  },
  budgetPolicies: {
    id: "budget_policies.id",
    tenant_id: "budget_policies.tenant_id",
    agent_id: "budget_policies.agent_id",
    user_id: "budget_policies.user_id",
    scope: "budget_policies.scope",
  },
  users: {
    id: "users.id",
    tenant_id: "users.tenant_id",
  },
  and: (...args: unknown[]) => ({ _and: args }),
  eq: (...args: unknown[]) => ({ _eq: args }),
  snakeToCamel,
}));
vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: mocks.requireAdminOrServiceCaller,
}));

// eslint-disable-next-line import/first
import { upsertBudgetPolicy } from "./upsertBudgetPolicy.mutation.js";

beforeEach(() => {
  mocks.selectRows = [];
  mocks.insertValues.mockClear();
  mocks.requireAdminOrServiceCaller.mockReset();
  mocks.requireAdminOrServiceCaller.mockResolvedValue(undefined);
  mocks.updateSet.mockClear();
});

function cognitoCtx(): any {
  return { auth: { authType: "cognito" } };
}

describe("upsertBudgetPolicy", () => {
  it("requires userId for user-scoped policies", async () => {
    await expect(
      upsertBudgetPolicy(
        null,
        {
          tenantId: "tenant-1",
          input: { scope: "user", limitUsd: 25 },
        },
        cognitoCtx(),
      ),
    ).rejects.toThrow("userId required for user-scope policy");
    expect(mocks.requireAdminOrServiceCaller).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-1",
      "budget_policy:update",
    );
  });

  it("rejects a user-scoped policy for a user outside the tenant", async () => {
    mocks.selectRows = [[]];

    await expect(
      upsertBudgetPolicy(
        null,
        {
          tenantId: "tenant-1",
          input: { scope: "user", userId: "user-2", limitUsd: 25 },
        },
        cognitoCtx(),
      ),
    ).rejects.toThrow("userId must belong to tenant");
  });

  it("inserts a user-scoped budget policy after tenant ownership validation", async () => {
    mocks.selectRows = [[{ id: "user-1" }], []];

    const result = await upsertBudgetPolicy(
      null,
      {
        tenantId: "tenant-1",
        input: {
          scope: "user",
          userId: "user-1",
          limitUsd: 40,
          period: "monthly",
        },
      },
      cognitoCtx(),
    );

    expect(mocks.requireAdminOrServiceCaller).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-1",
      "budget_policy:update",
    );
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: "tenant-1",
        user_id: "user-1",
        agent_id: null,
        scope: "user",
        limit_usd: "40",
      }),
    );
    expect(result).toMatchObject({
      userId: "user-1",
      agentId: null,
      scope: "user",
      limitUsd: 40,
    });
  });

  it("rejects before tenant/user validation when the admin gate rejects", async () => {
    mocks.requireAdminOrServiceCaller.mockRejectedValue(
      Object.assign(new Error("Tenant admin role required"), {
        extensions: { code: "FORBIDDEN" },
      }),
    );

    await expect(
      upsertBudgetPolicy(
        null,
        {
          tenantId: "tenant-1",
          input: {
            scope: "user",
            userId: "user-1",
            limitUsd: 40,
            period: "monthly",
          },
        },
        cognitoCtx(),
      ),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });

    expect(mocks.selectRows).toEqual([]);
    expect(mocks.insertValues).not.toHaveBeenCalled();
    expect(mocks.updateSet).not.toHaveBeenCalled();
  });
});
