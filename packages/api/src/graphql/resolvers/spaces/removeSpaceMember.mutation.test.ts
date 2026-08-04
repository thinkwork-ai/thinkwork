import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authCalls,
  deletes,
  deleteResults,
  invalidations,
  notifications,
  selectQueue,
  resetMocks,
} = vi.hoisted(() => {
  const authCalls: unknown[] = [];
  const deletes: unknown[] = [];
  const deleteResults: unknown[][] = [];
  const notifications: unknown[] = [];
  const invalidations: unknown[] = [];
  const selectQueue: unknown[][] = [];
  return {
    authCalls,
    deletes,
    deleteResults,
    notifications,
    invalidations,
    selectQueue,
    resetMocks: () => {
      authCalls.length = 0;
      deletes.length = 0;
      deleteResults.length = 0;
      notifications.length = 0;
      invalidations.length = 0;
      selectQueue.length = 0;
    },
  };
});

vi.mock("../../utils.js", () => {
  const col = (name: string) => ({ name });
  const selectResult = () => {
    const result = Promise.resolve(selectQueue.shift() ?? []);
    return Object.assign(result, { for: () => result });
  };
  const database = {
    select: () => ({
      from: () => ({
        where: selectResult,
      }),
    }),
    delete: () => ({
      where: (clause: unknown) => {
        deletes.push(clause);
        return {
          returning: () => Promise.resolve(deleteResults.shift() ?? []),
        };
      },
    }),
    insert: () => ({
      values: (value: unknown) => {
        invalidations.push(value);
        return Promise.resolve();
      },
    }),
  };
  return {
    spaces: {
      id: col("spaces.id"),
      tenant_id: col("spaces.tenant_id"),
    },
    spaceMembers: {
      id: col("space_members.id"),
      tenant_id: col("space_members.tenant_id"),
      space_id: col("space_members.space_id"),
      user_id: col("space_members.user_id"),
      role: col("space_members.role"),
    },
    db: {
      ...database,
      transaction: (callback: (tx: typeof database) => unknown) =>
        callback(database),
    },
    and: (...items: unknown[]) => ({ and: items }),
    eq: (left: unknown, right: unknown) => ({ eq: [left, right] }),
  };
});

vi.mock("@thinkwork/database-pg/schema", () => ({
  authSubscriptionInvalidations: { name: "auth_subscription_invalidations" },
}));

vi.mock("drizzle-orm", () => ({
  ne: (left: unknown, right: unknown) => ({ ne: [left, right] }),
}));

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: (...args: unknown[]) => {
    authCalls.push(args);
    return Promise.resolve();
  },
}));

vi.mock("../../notify.js", () => ({
  notifyWorkspaceAccessRevoked: (payload: unknown) => {
    notifications.push(payload);
    return Promise.resolve();
  },
}));

describe("removeSpaceMember", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("deletes a member-role row and returns true", async () => {
    selectQueue.push([{ tenant_id: "tenant-1" }]);
    selectQueue.push([{ role: "member" }]);
    deleteResults.push([{ id: "member-1" }]);

    const { removeSpaceMember } =
      await import("./removeSpaceMember.mutation.js");

    const result = await removeSpaceMember(
      null,
      { spaceId: "space-1", userId: "user-2" },
      { auth: { authType: "cognito" } } as any,
    );

    expect(result).toBe(true);
    expect(deletes).toHaveLength(1);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      tenantId: "tenant-1",
      spaceId: "space-1",
      userId: "user-2",
    });
    expect(invalidations).toEqual([
      {
        tenant_id: "tenant-1",
        user_id: "user-2",
        resource_kind: "space_membership",
        reason: "space_membership_removed",
      },
    ]);
    expect(authCalls[0]).toEqual([
      { auth: { authType: "cognito" } },
      "tenant-1",
    ]);
  });

  it("refuses to remove the owner row", async () => {
    selectQueue.push([{ tenant_id: "tenant-1" }]);
    selectQueue.push([{ role: "owner" }]);

    const { removeSpaceMember } =
      await import("./removeSpaceMember.mutation.js");

    await expect(
      removeSpaceMember(null, { spaceId: "space-1", userId: "owner-user" }, {
        auth: { authType: "cognito" },
      } as any),
    ).rejects.toMatchObject({
      extensions: { code: "CANNOT_REMOVE_OWNER" },
    });
    expect(deletes).toEqual([]);
    expect(notifications).toEqual([]);
    expect(invalidations).toEqual([]);
  });

  it("returns false when the user is not a member", async () => {
    selectQueue.push([{ tenant_id: "tenant-1" }]);
    selectQueue.push([]);

    const { removeSpaceMember } =
      await import("./removeSpaceMember.mutation.js");

    const result = await removeSpaceMember(
      null,
      { spaceId: "space-1", userId: "stranger" },
      { auth: { authType: "cognito" } } as any,
    );

    expect(result).toBe(false);
    expect(deletes).toEqual([]);
    expect(notifications).toEqual([]);
  });

  it("returns false when role changed to owner between read and delete", async () => {
    selectQueue.push([{ tenant_id: "tenant-1" }]);
    selectQueue.push([{ role: "member" }]);
    deleteResults.push([]);

    const { removeSpaceMember } =
      await import("./removeSpaceMember.mutation.js");

    const result = await removeSpaceMember(
      null,
      { spaceId: "space-1", userId: "user-2" },
      { auth: { authType: "cognito" } } as any,
    );

    expect(result).toBe(false);
    expect(deletes).toHaveLength(1);
    expect(notifications).toEqual([]);
  });

  it("rejects when the Space is missing", async () => {
    selectQueue.push([]);

    const { removeSpaceMember } =
      await import("./removeSpaceMember.mutation.js");

    await expect(
      removeSpaceMember(null, { spaceId: "missing", userId: "user-2" }, {
        auth: { authType: "cognito" },
      } as any),
    ).rejects.toThrow("Space not found");
    expect(authCalls).toEqual([]);
    expect(deletes).toEqual([]);
    expect(notifications).toEqual([]);
  });
});
