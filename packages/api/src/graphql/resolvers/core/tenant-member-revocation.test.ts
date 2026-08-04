import { beforeEach, describe, expect, it, vi } from "vitest";

const { inserted, selectQueue, returningQueue, updates } = vi.hoisted(() => ({
  inserted: [] as unknown[],
  selectQueue: [] as unknown[][],
  returningQueue: [] as unknown[][],
  updates: [] as unknown[],
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  authSubscriptionInvalidations: { name: "auth_subscription_invalidations" },
}));

vi.mock("../../utils.js", () => {
  const column = (name: string) => ({ name });
  const selectResult = () => {
    const result = Promise.resolve(selectQueue.shift() ?? []);
    return Object.assign(result, { for: () => result });
  };
  const tx = {
    select: () => ({ from: () => ({ where: selectResult }) }),
    delete: () => ({
      where: () => ({
        returning: () => Promise.resolve(returningQueue.shift() ?? []),
      }),
    }),
    update: () => ({
      set: (value: unknown) => {
        updates.push(value);
        return {
          where: () => ({
            returning: () => Promise.resolve(returningQueue.shift() ?? []),
          }),
        };
      },
    }),
    insert: () => ({
      values: (value: unknown) => {
        inserted.push(value);
        return Promise.resolve();
      },
    }),
  };
  return {
    and: (...values: unknown[]) => ({ and: values }),
    db: {
      transaction: (callback: (value: typeof tx) => unknown) => callback(tx),
    },
    eq: (left: unknown, right: unknown) => ({ eq: [left, right] }),
    snakeToCamel: (value: unknown) => value,
    tenantMembers: {
      id: column("tenant_members.id"),
      tenant_id: column("tenant_members.tenant_id"),
      role: column("tenant_members.role"),
    },
  };
});

vi.mock("./resolve-auth-user.js", () => ({
  resolveCaller: async () => ({ userId: "caller-user" }),
}));

vi.mock("./authz.js", () => ({
  requireTenantAdmin: async () => "owner",
}));

describe("tenant membership subscription invalidation", () => {
  beforeEach(() => {
    inserted.length = 0;
    selectQueue.length = 0;
    returningQueue.length = 0;
    updates.length = 0;
  });

  it("atomically enqueues user-scope invalidation when a membership is removed", async () => {
    selectQueue.push([
      {
        id: "membership-1",
        tenant_id: "tenant-1",
        principal_type: "user",
        principal_id: "target-user",
        role: "member",
        status: "active",
      },
    ]);
    returningQueue.push([{ id: "membership-1" }]);
    const { removeTenantMember } = await import(
      "./removeTenantMember.mutation.js"
    );

    await expect(
      removeTenantMember(null, { id: "membership-1" }, {} as never),
    ).resolves.toBe(true);
    expect(inserted).toEqual([
      {
        tenant_id: "tenant-1",
        user_id: "target-user",
        resource_kind: "membership",
        reason: "membership_removed",
      },
    ]);
  });

  it("atomically enqueues invalidation only when an active user is disabled", async () => {
    selectQueue.push([
      {
        id: "membership-1",
        tenant_id: "tenant-1",
        principal_type: "user",
        principal_id: "target-user",
        role: "member",
        status: "active",
      },
    ]);
    returningQueue.push([
      {
        id: "membership-1",
        tenant_id: "tenant-1",
        principal_id: "target-user",
        status: "disabled",
      },
    ]);
    const { updateTenantMember } = await import(
      "./updateTenantMember.mutation.js"
    );

    await updateTenantMember(
      null,
      { id: "membership-1", input: { status: "disabled" } },
      {} as never,
    );
    expect(updates).toHaveLength(1);
    expect(inserted).toEqual([
      {
        tenant_id: "tenant-1",
        user_id: "target-user",
        resource_kind: "membership",
        reason: "membership_disabled",
      },
    ]);
  });
});
