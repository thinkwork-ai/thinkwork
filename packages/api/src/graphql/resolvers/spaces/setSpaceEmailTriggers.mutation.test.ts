import { beforeEach, describe, expect, it, vi } from "vitest";

const { authCalls, updateSets, selectRows, resetMocks } = vi.hoisted(() => {
  const authCalls: unknown[] = [];
  const updateSets: unknown[] = [];
  const selectRows: unknown[][] = [];
  return {
    authCalls,
    updateSets,
    selectRows,
    resetMocks: () => {
      authCalls.length = 0;
      updateSets.length = 0;
      selectRows.length = 0;
      selectRows.push([{ tenant_id: "tenant-1" }]);
    },
  };
});

vi.mock("../../utils.js", () => {
  const col = (name: string) => ({ name });
  return {
    spaces: {
      id: col("spaces.id"),
      tenant_id: col("spaces.tenant_id"),
    },
    db: {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve(selectRows.shift() ?? []),
        }),
      }),
      update: () => ({
        set: (updates: Record<string, unknown>) => {
          updateSets.push(updates);
          return {
            where: () => ({
              returning: () =>
                Promise.resolve([
                  {
                    id: "space-1",
                    tenant_id: "tenant-1",
                    slug: "finance",
                    name: "Finance",
                    status: "active",
                    kind: "custom",
                    access_mode: "private",
                    email_triggers_enabled: updates.email_triggers_enabled,
                    updated_at: updates.updated_at,
                  },
                ]),
            }),
          };
        },
      }),
    },
    and: (...items: unknown[]) => ({ and: items }),
    eq: (left: unknown, right: unknown) => ({ eq: [left, right] }),
    snakeToCamel: (row: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key.replace(/_([a-z])/g, (_, char) => char.toUpperCase()),
          value,
        ]),
      ),
  };
});

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: (...args: unknown[]) => {
    authCalls.push(args);
    return Promise.resolve();
  },
}));

describe("setSpaceEmailTriggers", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("requires admin access to the Space tenant before toggling email triggers", async () => {
    const { setSpaceEmailTriggers } =
      await import("./setSpaceEmailTriggers.mutation.js");

    const result = await setSpaceEmailTriggers(
      null,
      { spaceId: "space-1", enabled: true },
      { auth: { authType: "cognito" } } as any,
    );

    expect(authCalls[0]).toEqual([
      { auth: { authType: "cognito" } },
      "tenant-1",
      "set_space_email_triggers",
    ]);
    expect(updateSets[0]).toMatchObject({
      email_triggers_enabled: true,
    });
    expect(updateSets[0]).toHaveProperty("updated_at");
    expect(result).toMatchObject({
      id: "space-1",
      accessMode: "PRIVATE",
      emailTriggersEnabled: true,
    });
  });

  it("rejects unknown Spaces before authorizing against a tenant", async () => {
    selectRows.length = 0;
    selectRows.push([]);

    const { setSpaceEmailTriggers } =
      await import("./setSpaceEmailTriggers.mutation.js");

    await expect(
      setSpaceEmailTriggers(
        null,
        { spaceId: "missing-space", enabled: false },
        { auth: { authType: "cognito" } } as any,
      ),
    ).rejects.toThrow("Space not found");
    expect(authCalls).toEqual([]);
    expect(updateSets).toEqual([]);
  });
});
