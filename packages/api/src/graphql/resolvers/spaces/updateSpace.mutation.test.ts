import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateSets, authCalls, resetMocks } = vi.hoisted(() => {
  const updateSets: unknown[] = [];
  const authCalls: unknown[] = [];
  return {
    updateSets,
    authCalls,
    resetMocks: () => {
      updateSets.length = 0;
      authCalls.length = 0;
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
                    slug: "customer-onboarding",
                    name: updates.name ?? "Customer Onboarding",
                    description: updates.description ?? null,
                    access_mode: updates.access_mode ?? "public",
                    status: "active",
                    kind: "custom",
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

describe("updateSpace", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("updates editable Space fields including access mode", async () => {
    const { updateSpace } = await import("./updateSpace.mutation.js");

    const result = await updateSpace(
      null,
      {
        input: {
          tenantId: "tenant-1",
          spaceId: "space-1",
          name: " Customer Success ",
          description: " Shared onboarding ",
          accessMode: "PRIVATE",
        },
      },
      { auth: { authType: "cognito" } } as any,
    );

    expect(authCalls[0]).toEqual([
      { auth: { authType: "cognito" } },
      "tenant-1",
      "update_space",
    ]);
    expect(updateSets[0]).toMatchObject({
      name: "Customer Success",
      description: "Shared onboarding",
      access_mode: "private",
    });
    expect(updateSets[0]).not.toHaveProperty("slug");
    expect(result).toMatchObject({
      id: "space-1",
      name: "Customer Success",
      accessMode: "PRIVATE",
    });
  });

  it("rejects blank names and invalid access modes", async () => {
    const { updateSpace } = await import("./updateSpace.mutation.js");

    await expect(
      updateSpace(
        null,
        {
          input: {
            tenantId: "tenant-1",
            spaceId: "space-1",
            name: " ",
          },
        },
        { auth: { authType: "cognito" } } as any,
      ),
    ).rejects.toThrow("Space name is required");

    await expect(
      updateSpace(
        null,
        {
          input: {
            tenantId: "tenant-1",
            spaceId: "space-1",
            accessMode: "team-only",
          },
        },
        { auth: { authType: "cognito" } } as any,
      ),
    ).rejects.toThrow("Invalid Space access mode");
  });
});
