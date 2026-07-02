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
              returning: () => Promise.resolve([{ id: "space-1" }]),
            }),
          };
        },
      }),
    },
    and: (...items: unknown[]) => ({ and: items }),
    eq: (left: unknown, right: unknown) => ({ eq: [left, right] }),
  };
});

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: (...args: unknown[]) => {
    authCalls.push(args);
    return Promise.resolve();
  },
}));

describe("deleteSpace", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("archives a Space instead of physically deleting it", async () => {
    const { deleteSpace } = await import("./deleteSpace.mutation.js");

    const result = await deleteSpace(
      null,
      { tenantId: "tenant-1", id: "space-1" },
      { auth: { authType: "cognito" } } as any,
    );

    expect(authCalls[0]).toEqual([
      { auth: { authType: "cognito" } },
      "tenant-1",
      "delete_space",
    ]);
    expect(updateSets[0]).toMatchObject({ status: "archived" });
    expect(result).toBe(true);
  });
});
