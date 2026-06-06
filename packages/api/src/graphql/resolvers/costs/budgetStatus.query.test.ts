import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Array<Record<string, unknown>>>,
  eq: vi.fn(),
}));

function queryChain() {
  const rows = () => Promise.resolve(mocks.rows.shift() ?? []);
  const chain = {
    from: () => chain,
    where: () => chain,
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
    enabled: row.enabled,
  };
}

vi.mock("../../utils.js", () => ({
  db: {
    select: () => queryChain(),
  },
  budgetPolicies: {
    tenant_id: "budget_policies.tenant_id",
    agent_id: "budget_policies.agent_id",
    user_id: "budget_policies.user_id",
    scope: "budget_policies.scope",
    enabled: "budget_policies.enabled",
  },
  costEvents: {
    tenant_id: "cost_events.tenant_id",
    agent_id: "cost_events.agent_id",
    user_id: "cost_events.user_id",
    created_at: "cost_events.created_at",
  },
  and: (...args: unknown[]) => ({ _and: args }),
  eq: (...args: unknown[]) => {
    mocks.eq(...args);
    return { _eq: args };
  },
  gte: (...args: unknown[]) => ({ _gte: args }),
  sql: () => "sql",
  snakeToCamel,
  startOfMonth: () => new Date("2026-06-01T00:00:00.000Z"),
}));

// eslint-disable-next-line import/first
import { budgetStatus, budgetStatusForPolicy } from "./budgetStatus.query.js";

beforeEach(() => {
  mocks.rows = [];
  mocks.eq.mockClear();
});

describe("budgetStatus", () => {
  it("computes user policies from user-attributed spend only", async () => {
    mocks.rows = [[{ total: 81 }]];

    await expect(
      budgetStatusForPolicy(
        {
          id: "policy-user",
          tenant_id: "tenant-1",
          scope: "user",
          user_id: "user-1",
          agent_id: null,
          period: "monthly",
          limit_usd: "100.00",
          action_on_exceed: "pause",
          enabled: true,
        },
        "tenant-1",
      ),
    ).resolves.toMatchObject({
      policy: {
        id: "policy-user",
        userId: "user-1",
        scope: "user",
        limitUsd: 100,
      },
      spentUsd: 81,
      remainingUsd: 19,
      percentUsed: 81,
      status: "warning",
    });

    expect(mocks.eq).toHaveBeenCalledWith("cost_events.user_id", "user-1");
  });

  it("returns status for all enabled tenant policies", async () => {
    mocks.rows = [
      [
        {
          id: "policy-tenant",
          tenant_id: "tenant-1",
          scope: "tenant",
          period: "monthly",
          limit_usd: "10.00",
          action_on_exceed: "pause",
          enabled: true,
        },
        {
          id: "policy-user",
          tenant_id: "tenant-1",
          scope: "user",
          user_id: "user-1",
          period: "monthly",
          limit_usd: "20.00",
          action_on_exceed: "pause",
          enabled: true,
        },
      ],
      [{ total: 3 }],
      [{ total: 25 }],
    ];

    await expect(
      budgetStatus(null, { tenantId: "tenant-1" }, {} as any),
    ).resolves.toMatchObject([
      { spentUsd: 3, status: "normal" },
      { spentUsd: 25, status: "exceeded" },
    ]);
  });
});
