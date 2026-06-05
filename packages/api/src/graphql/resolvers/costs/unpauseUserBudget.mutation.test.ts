import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectRows: [] as Array<Array<Record<string, unknown>>>,
  updateSet: vi.fn(),
  returningRows: [] as Array<Record<string, unknown>>,
  eq: vi.fn(),
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

vi.mock("../../utils.js", () => ({
  db: {
    select: () => selectChain(),
    update: () => ({
      set: (value: Record<string, unknown>) => {
        mocks.updateSet(value);
        return {
          where: () => ({
            returning: async () => mocks.returningRows,
          }),
        };
      },
    }),
  },
  scheduledJobs: {
    id: "scheduled_jobs.id",
    tenant_id: "scheduled_jobs.tenant_id",
    enabled: "scheduled_jobs.enabled",
    budget_paused: "scheduled_jobs.budget_paused",
    budget_paused_at: "scheduled_jobs.budget_paused_at",
    budget_paused_reason: "scheduled_jobs.budget_paused_reason",
    created_by_type: "scheduled_jobs.created_by_type",
    created_by_id: "scheduled_jobs.created_by_id",
    config: "scheduled_jobs.config",
  },
  users: {
    id: "users.id",
    tenant_id: "users.tenant_id",
  },
  and: (...args: unknown[]) => ({ _and: args }),
  or: (...args: unknown[]) => ({ _or: args }),
  eq: (...args: unknown[]) => {
    mocks.eq(...args);
    return { _eq: args };
  },
  sql: () => "sql",
}));

// eslint-disable-next-line import/first
import { unpauseUserBudget } from "./unpauseUserBudget.mutation.js";

beforeEach(() => {
  mocks.selectRows = [];
  mocks.returningRows = [];
  mocks.updateSet.mockClear();
  mocks.eq.mockClear();
});

describe("unpauseUserBudget", () => {
  it("throws when the user does not belong to the tenant", async () => {
    mocks.selectRows = [[]];

    await expect(
      unpauseUserBudget(
        null,
        { tenantId: "tenant-1", userId: "user-2" },
        {} as any,
      ),
    ).rejects.toThrow("User not found in tenant");

    expect(mocks.updateSet).not.toHaveBeenCalled();
  });

  it("clears only enabled user-owned budget pause rows and returns the count", async () => {
    mocks.selectRows = [[{ id: "user-1" }]];
    mocks.returningRows = [{ id: "job-1" }, { id: "job-2" }];

    await expect(
      unpauseUserBudget(
        null,
        { tenantId: "tenant-1", userId: "user-1" },
        {} as any,
      ),
    ).resolves.toBe(2);

    expect(mocks.updateSet).toHaveBeenCalledWith({
      budget_paused: false,
      budget_paused_at: null,
      budget_paused_reason: null,
      updated_at: expect.any(Date),
    });
    expect(mocks.eq).toHaveBeenCalledWith("scheduled_jobs.enabled", true);
    expect(mocks.eq).toHaveBeenCalledWith("scheduled_jobs.budget_paused", true);
    expect(mocks.eq).toHaveBeenCalledWith(
      "scheduled_jobs.created_by_id",
      "user-1",
    );
  });
});
