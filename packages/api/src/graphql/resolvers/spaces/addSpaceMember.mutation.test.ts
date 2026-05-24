import { beforeEach, describe, expect, it, vi } from "vitest";

const { authCalls, inserts, selectQueue, resetMocks } = vi.hoisted(() => {
  const authCalls: unknown[] = [];
  const inserts: unknown[] = [];
  const selectQueue: unknown[][] = [];
  return {
    authCalls,
    inserts,
    selectQueue,
    resetMocks: () => {
      authCalls.length = 0;
      inserts.length = 0;
      selectQueue.length = 0;
    },
  };
});

vi.mock("../../utils.js", () => {
  const col = (name: string) => ({ name });
  return {
    spaces: {
      id: col("spaces.id"),
      tenant_id: col("spaces.tenant_id"),
      access_mode: col("spaces.access_mode"),
    },
    spaceMembers: {
      tenant_id: col("space_members.tenant_id"),
      space_id: col("space_members.space_id"),
      user_id: col("space_members.user_id"),
      role: col("space_members.role"),
    },
    users: {
      id: col("users.id"),
      tenant_id: col("users.tenant_id"),
    },
    db: {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve(selectQueue.shift() ?? []),
        }),
      }),
      insert: () => ({
        values: (row: Record<string, unknown>) => {
          inserts.push(row);
          return {
            onConflictDoNothing: () => Promise.resolve(),
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
  requireTenantAdmin: (...args: unknown[]) => {
    authCalls.push(args);
    return Promise.resolve();
  },
}));

describe("addSpaceMember", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("inserts a member when the Space is private and the user belongs to the tenant", async () => {
    selectQueue.push([{ tenant_id: "tenant-1", access_mode: "private" }]);
    selectQueue.push([{ id: "user-2", tenant_id: "tenant-1" }]);
    selectQueue.push([
      {
        id: "member-1",
        tenant_id: "tenant-1",
        space_id: "space-1",
        user_id: "user-2",
        role: "member",
        notification_preference: "subscribed",
      },
    ]);

    const { addSpaceMember } = await import("./addSpaceMember.mutation.js");

    const result = await addSpaceMember(
      null,
      { spaceId: "space-1", userId: "user-2" },
      { auth: { authType: "cognito" } } as any,
    );

    expect(authCalls[0]).toEqual([
      { auth: { authType: "cognito" } },
      "tenant-1",
    ]);
    expect(inserts[0]).toMatchObject({
      tenant_id: "tenant-1",
      space_id: "space-1",
      user_id: "user-2",
      role: "member",
      notification_preference: "subscribed",
    });
    expect(result).toMatchObject({
      id: "member-1",
      role: "MEMBER",
      notificationPreference: "SUBSCRIBED",
    });
  });

  it("returns the existing row when the user is already a member (idempotent)", async () => {
    selectQueue.push([{ tenant_id: "tenant-1", access_mode: "private" }]);
    selectQueue.push([{ id: "user-2", tenant_id: "tenant-1" }]);
    selectQueue.push([
      {
        id: "member-existing",
        tenant_id: "tenant-1",
        space_id: "space-1",
        user_id: "user-2",
        role: "owner",
        notification_preference: "subscribed",
      },
    ]);

    const { addSpaceMember } = await import("./addSpaceMember.mutation.js");

    const result = await addSpaceMember(
      null,
      { spaceId: "space-1", userId: "user-2" },
      { auth: { authType: "cognito" } } as any,
    );

    expect(inserts).toHaveLength(1);
    expect(result).toMatchObject({
      id: "member-existing",
      role: "OWNER",
    });
  });

  it("rejects when the Space is public", async () => {
    selectQueue.push([{ tenant_id: "tenant-1", access_mode: "public" }]);

    const { addSpaceMember } = await import("./addSpaceMember.mutation.js");

    await expect(
      addSpaceMember(
        null,
        { spaceId: "space-1", userId: "user-2" },
        { auth: { authType: "cognito" } } as any,
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining("private Spaces"),
      extensions: { code: "SPACE_NOT_PRIVATE" },
    });
    expect(inserts).toEqual([]);
  });

  it("rejects when the userId belongs to a different tenant", async () => {
    selectQueue.push([{ tenant_id: "tenant-1", access_mode: "private" }]);
    selectQueue.push([{ id: "user-2", tenant_id: "tenant-other" }]);

    const { addSpaceMember } = await import("./addSpaceMember.mutation.js");

    await expect(
      addSpaceMember(
        null,
        { spaceId: "space-1", userId: "user-2" },
        { auth: { authType: "cognito" } } as any,
      ),
    ).rejects.toMatchObject({
      extensions: { code: "USER_NOT_IN_TENANT" },
    });
    expect(inserts).toEqual([]);
  });

  it("rejects when the Space is missing", async () => {
    selectQueue.push([]);

    const { addSpaceMember } = await import("./addSpaceMember.mutation.js");

    await expect(
      addSpaceMember(
        null,
        { spaceId: "missing", userId: "user-2" },
        { auth: { authType: "cognito" } } as any,
      ),
    ).rejects.toThrow("Space not found");
    expect(authCalls).toEqual([]);
    expect(inserts).toEqual([]);
  });
});
