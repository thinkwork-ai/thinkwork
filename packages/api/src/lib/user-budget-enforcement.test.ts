import { describe, expect, it, vi } from "vitest";

import {
  checkUserBudgetAndPauseWork,
  getUserBudgetStatus,
  resolveScheduledJobCostOwner,
  resolveTenantUserCostOwner,
} from "./user-budget-enforcement";

type Rows = Array<Record<string, unknown>>;

const createFakeDb = () => {
  const selectRows: Rows[] = [];
  const updateRows: Rows[] = [];
  const updateSets: unknown[] = [];
  const updateWheres: unknown[] = [];

  const chainRows = (rows: Rows) => {
    const resolved = Promise.resolve(rows);
    return {
      limit: () => resolved,
      then: (
        resolve: (value: Rows) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => resolved.then(resolve, reject),
    };
  };

  return {
    selectRows,
    updateRows,
    updateSets,
    updateWheres,
    db: {
      select: vi.fn(() => ({
        from: () => ({
          where: () => chainRows(selectRows.shift() ?? []),
        }),
      })),
      update: vi.fn(() => ({
        set: (value: unknown) => {
          updateSets.push(value);
          return {
            where: (condition: unknown) => {
              updateWheres.push(condition);
              return {
                returning: () => Promise.resolve(updateRows.shift() ?? []),
              };
            },
          };
        },
      })),
    },
  };
};

describe("resolveScheduledJobCostOwner", () => {
  it("prefers skill-run invoker identity from config", () => {
    expect(
      resolveScheduledJobCostOwner({
        created_by_type: "user",
        created_by_id: "creator-user",
        config: { invokerUserId: "invoker-user" },
      }),
    ).toBe("invoker-user");
  });

  it("falls back to user-created scheduled jobs", () => {
    expect(
      resolveScheduledJobCostOwner({
        created_by_type: "user",
        created_by_id: "creator-user",
        config: {},
      }),
    ).toBe("creator-user");
  });

  it("leaves system-owned scheduled jobs unattributed", () => {
    expect(
      resolveScheduledJobCostOwner({
        created_by_type: "system",
        created_by_id: "system",
        config: {},
      }),
    ).toBeNull();
  });
});

describe("getUserBudgetStatus", () => {
  it("validates tenant-owned cost users before attribution", async () => {
    const fake = createFakeDb();
    fake.selectRows.push([{ id: "user-1" }], []);

    await expect(
      resolveTenantUserCostOwner({
        tenantId: "tenant-1",
        userId: "user-1",
        db: fake.db as never,
      }),
    ).resolves.toBe("user-1");
    await expect(
      resolveTenantUserCostOwner({
        tenantId: "tenant-1",
        userId: "user-2",
        db: fake.db as never,
      }),
    ).resolves.toBeNull();
  });

  it("treats attribution lookup failures as unattributed cost", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      resolveTenantUserCostOwner({
        tenantId: "tenant-1",
        userId: "user-1",
        db: {
          select: () => {
            throw new Error("db unavailable");
          },
        } as never,
      }),
    ).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "[cost] user attribution lookup failed tenant=tenant-1 user=user-1:",
      expect.any(Error),
    );
    warn.mockRestore();
  });

  it("returns no_user without touching policies when no user owner is available", async () => {
    const fake = createFakeDb();

    await expect(
      getUserBudgetStatus({
        tenantId: "tenant-1",
        userId: null,
        db: fake.db as never,
      }),
    ).resolves.toMatchObject({
      state: "no_user",
      overBudget: false,
      spentUsd: 0,
    });
    expect(fake.db.select).not.toHaveBeenCalled();
  });

  it("rejects users that do not belong to the tenant", async () => {
    const fake = createFakeDb();
    fake.selectRows.push([]);

    await expect(
      getUserBudgetStatus({
        tenantId: "tenant-1",
        userId: "user-other-tenant",
        db: fake.db as never,
      }),
    ).resolves.toMatchObject({
      state: "unowned_user",
      userId: "user-other-tenant",
      overBudget: false,
    });
    expect(fake.db.select).toHaveBeenCalledTimes(1);
  });

  it("computes month-to-date spend for an enabled user policy", async () => {
    const fake = createFakeDb();
    fake.selectRows.push(
      [{ id: "user-1" }],
      [{ id: "policy-1", limit_usd: "10.00" }],
      [{ total: 8 }],
    );

    await expect(
      getUserBudgetStatus({
        tenantId: "tenant-1",
        userId: "user-1",
        monthStart: new Date("2026-06-01T00:00:00Z"),
        db: fake.db as never,
      }),
    ).resolves.toMatchObject({
      state: "warning",
      policyId: "policy-1",
      spentUsd: 8,
      remainingUsd: 2,
      percentUsed: 80,
      overBudget: false,
    });
  });

  it("excludes runtime-only usage from the default strict budget spend", async () => {
    const fake = createFakeDb();
    fake.selectRows.push(
      [{ id: "user-1" }],
      [{ id: "policy-1", limit_usd: "10.00" }],
      [
        {
          totalUsd: 12,
          enforcedUsd: 0,
          estimatedUsd: 12,
          invocationReconciledUsd: 0,
          billReconciledUsd: 0,
          mismatchUsd: 0,
          unreconciledUsd: 0,
        },
      ],
    );

    await expect(
      getUserBudgetStatus({
        tenantId: "tenant-1",
        userId: "user-1",
        monthStart: new Date("2026-06-01T00:00:00Z"),
        db: fake.db as never,
      }),
    ).resolves.toMatchObject({
      state: "normal",
      spentUsd: 0,
      visibleSpendUsd: 12,
      estimatedUsd: 12,
      minimumReconciliationState: "bill-reconciled",
      overBudget: false,
    });
  });

  it("can enforce invocation-reconciled usage when configured", async () => {
    const fake = createFakeDb();
    fake.selectRows.push(
      [{ id: "user-1" }],
      [{ id: "policy-1", limit_usd: "10.00" }],
      [
        {
          totalUsd: 12,
          enforcedUsd: 12,
          estimatedUsd: 0,
          invocationReconciledUsd: 12,
          billReconciledUsd: 0,
          mismatchUsd: 0,
          unreconciledUsd: 0,
        },
      ],
    );

    await expect(
      getUserBudgetStatus({
        tenantId: "tenant-1",
        userId: "user-1",
        monthStart: new Date("2026-06-01T00:00:00Z"),
        minimumReconciliationState: "invocation-reconciled",
        db: fake.db as never,
      }),
    ).resolves.toMatchObject({
      state: "exceeded",
      spentUsd: 12,
      visibleSpendUsd: 12,
      invocationReconciledUsd: 12,
      minimumReconciliationState: "invocation-reconciled",
      overBudget: true,
    });
  });
});

describe("checkUserBudgetAndPauseWork", () => {
  it("pauses enabled user-owned scheduled work when spend exceeds the user policy", async () => {
    const fake = createFakeDb();
    fake.selectRows.push(
      [{ id: "user-1" }],
      [{ id: "policy-1", limit_usd: "10.00" }],
      [{ total: 12.5 }],
    );
    fake.updateRows.push([{ id: "job-1" }, { id: "job-2" }]);
    const now = new Date("2026-06-05T18:00:00Z");

    await expect(
      checkUserBudgetAndPauseWork({
        tenantId: "tenant-1",
        userId: "user-1",
        monthStart: new Date("2026-06-01T00:00:00Z"),
        now,
        db: fake.db as never,
      }),
    ).resolves.toMatchObject({
      state: "exceeded",
      overBudget: true,
      pausedScheduledJobCount: 2,
      pauseReason: "User budget exceeded: $12.50 >= $10.00",
    });

    expect(fake.updateSets).toEqual([
      expect.objectContaining({
        budget_paused: true,
        budget_paused_at: now,
        budget_paused_reason: "User budget exceeded: $12.50 >= $10.00",
      }),
    ]);
  });

  it("does not mutate scheduled jobs for users without a matching policy", async () => {
    const fake = createFakeDb();
    fake.selectRows.push([{ id: "user-1" }], []);

    await expect(
      checkUserBudgetAndPauseWork({
        tenantId: "tenant-1",
        userId: "user-1",
        db: fake.db as never,
      }),
    ).resolves.toMatchObject({
      state: "no_policy",
      overBudget: false,
      pausedScheduledJobCount: 0,
    });
    expect(fake.db.update).not.toHaveBeenCalled();
  });
});
