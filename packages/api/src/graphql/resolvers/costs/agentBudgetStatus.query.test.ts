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
    agent_id: "budget_policies.agent_id",
    scope: "budget_policies.scope",
    enabled: "budget_policies.enabled",
  },
  and: (...args: unknown[]) => ({ _and: args }),
  eq: (...args: unknown[]) => ({ _eq: args }),
}));

vi.mock("./budgetStatus.query.js", () => ({
  budgetStatusForPolicy: mocks.budgetStatusForPolicy,
}));

// eslint-disable-next-line import/first
import { agentBudgetStatus } from "./agentBudgetStatus.query.js";

beforeEach(() => {
  mocks.rows = [];
  mocks.budgetStatusForPolicy.mockReset();
});

describe("agentBudgetStatus", () => {
  it("returns null when the agent has no enabled budget policy", async () => {
    mocks.rows = [[]];

    await expect(
      agentBudgetStatus(null, { agentId: "agent-1" }, {} as never),
    ).resolves.toBeNull();
    expect(mocks.budgetStatusForPolicy).not.toHaveBeenCalled();
  });

  it("delegates agent policy spend to the confidence-aware budget helper", async () => {
    const policy = {
      id: "policy-agent",
      tenant_id: "tenant-1",
      scope: "agent",
      agent_id: "agent-1",
    };
    mocks.rows = [[policy]];
    mocks.budgetStatusForPolicy.mockResolvedValue({
      spentUsd: 4,
      visibleSpendUsd: 10,
      status: "normal",
    });

    await expect(
      agentBudgetStatus(null, { agentId: "agent-1" }, {} as never),
    ).resolves.toEqual({
      spentUsd: 4,
      visibleSpendUsd: 10,
      status: "normal",
    });
    expect(mocks.budgetStatusForPolicy).toHaveBeenCalledWith(
      policy,
      "tenant-1",
    );
  });
});
