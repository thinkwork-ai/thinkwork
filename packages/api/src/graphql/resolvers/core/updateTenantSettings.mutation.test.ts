import { beforeEach, describe, expect, it, vi } from "vitest";

const { authCalls, updateSets, authError, resetMocks } = vi.hoisted(() => {
  const authCalls: unknown[] = [];
  const updateSets: Record<string, unknown>[] = [];
  const authError: { current: Error | null } = { current: null };
  return {
    authCalls,
    updateSets,
    authError,
    resetMocks: () => {
      authCalls.length = 0;
      updateSets.length = 0;
      authError.current = null;
    },
  };
});

vi.mock("../../utils.js", () => {
  const col = (name: string) => ({ name });
  return {
    tenantSettings: {
      tenant_id: col("tenant_settings.tenant_id"),
    },
    db: {
      update: () => ({
        set: (updates: Record<string, unknown>) => {
          updateSets.push(updates);
          return {
            where: () => ({
              returning: () =>
                Promise.resolve([
                  {
                    id: "settings-1",
                    tenant_id: "tenant-1",
                    goal_default_token_budget:
                      updates.goal_default_token_budget,
                    updated_at: updates.updated_at,
                  },
                ]),
            }),
          };
        },
      }),
    },
    eq: (left: unknown, right: unknown) => ({ eq: [left, right] }),
    snakeToCamel: (row: Record<string, unknown>) => ({
      id: row.id,
      tenantId: row.tenant_id,
      goalDefaultTokenBudget: row.goal_default_token_budget,
      updatedAt: row.updated_at,
    }),
  };
});

vi.mock("./authz.js", () => ({
  requireAdminOrServiceCaller: (...args: unknown[]) => {
    authCalls.push(args);
    if (authError.current) return Promise.reject(authError.current);
    return Promise.resolve();
  },
}));

describe("updateTenantSettings", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("saves a positive goal token budget after admin authorization", async () => {
    const { updateTenantSettings } =
      await import("./updateTenantSettings.mutation.js");

    const result = await updateTenantSettings(
      null,
      {
        tenantId: "tenant-1",
        input: { goalDefaultTokenBudget: 150_000 },
      },
      { auth: { authType: "cognito" } } as any,
    );

    expect(authCalls[0]).toEqual([
      { auth: { authType: "cognito" } },
      "tenant-1",
      "update_tenant_settings",
    ]);
    expect(updateSets[0]).toMatchObject({
      goal_default_token_budget: 150_000,
    });
    expect(updateSets[0]).toHaveProperty("updated_at");
    expect(result.goalDefaultTokenBudget).toBe(150_000);
  });

  it("allows clearing the saved goal token budget to use the built-in fallback", async () => {
    const { updateTenantSettings } =
      await import("./updateTenantSettings.mutation.js");

    const result = await updateTenantSettings(
      null,
      {
        tenantId: "tenant-1",
        input: { goalDefaultTokenBudget: null },
      },
      { auth: { authType: "cognito" } } as any,
    );

    expect(updateSets[0]).toMatchObject({
      goal_default_token_budget: null,
    });
    expect(result.goalDefaultTokenBudget).toBeNull();
  });

  it.each([0, -1, 1.5, 2_000_001, "100000"])(
    "rejects invalid goal token budget value %s",
    async (goalDefaultTokenBudget) => {
      const { updateTenantSettings } =
        await import("./updateTenantSettings.mutation.js");

      await expect(
        updateTenantSettings(
          null,
          {
            tenantId: "tenant-1",
            input: { goalDefaultTokenBudget },
          },
          { auth: { authType: "cognito" } } as any,
        ),
      ).rejects.toThrow(
        "Goal token budget must be a positive whole number no greater than 2000000.",
      );
      expect(updateSets).toHaveLength(0);
    },
  );

  it("does not update settings when admin authorization fails", async () => {
    authError.current = new Error("FORBIDDEN");
    const { updateTenantSettings } =
      await import("./updateTenantSettings.mutation.js");

    await expect(
      updateTenantSettings(
        null,
        {
          tenantId: "tenant-1",
          input: { goalDefaultTokenBudget: 150_000 },
        },
        { auth: { authType: "cognito" } } as any,
      ),
    ).rejects.toThrow("FORBIDDEN");
    expect(updateSets).toHaveLength(0);
  });
});
