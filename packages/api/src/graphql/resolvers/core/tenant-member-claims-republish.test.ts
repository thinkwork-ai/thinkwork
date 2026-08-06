/**
 * Membership → Brain claims republish tests (THINK-625).
 *
 * Revocation is only real once the manifest says so: the Brain reads
 * `user-claims/<tenantId>/latest.json`, not tenant_members. These tests pin
 * that disabling or removing a member republishes, that the republish
 * happens AFTER the transaction has committed (never inside it), and that
 * no-op membership edits don't churn S3.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  selectQueue,
  txSpy,
  mockRequireTenantAdmin,
  mockResolveCaller,
  mockRepublish,
} = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  txSpy: { committed: false, republishedDuringTx: false },
  mockRequireTenantAdmin: vi.fn(),
  mockResolveCaller: vi.fn(),
  mockRepublish: vi.fn(),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  authSubscriptionInvalidations: { __table: "auth_subscription_invalidations" },
}));

vi.mock("../../utils.js", () => {
  const selectChain = () => {
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      for: () => Promise.resolve(selectQueue.shift() ?? []),
    };
    return chain;
  };
  const txLike = {
    select: selectChain,
    insert: () => ({ values: () => Promise.resolve(undefined) }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () =>
            Promise.resolve([{ id: "member-1", status: "disabled" }]),
        }),
      }),
    }),
    delete: () => ({
      where: () => ({
        returning: () => Promise.resolve([{ id: "member-1" }]),
      }),
    }),
  };
  return {
    db: {
      transaction: async (cb: (tx: unknown) => unknown) => {
        const result = await cb(txLike);
        // Anything the republish observes must be post-commit state.
        txSpy.republishedDuringTx = mockRepublish.mock.calls.length > 0;
        txSpy.committed = true;
        return result;
      },
    },
    eq: (...args: unknown[]) => ({ eq: args }),
    and: (...args: unknown[]) => ({ and: args }),
    tenantMembers: { id: "tm.id", tenant_id: "tm.tenant_id", role: "tm.role" },
    snakeToCamel: (row: Record<string, unknown>) => ({ ...row }),
  };
});

vi.mock("./authz.js", () => ({ requireTenantAdmin: mockRequireTenantAdmin }));
vi.mock("./resolve-auth-user.js", () => ({ resolveCaller: mockResolveCaller }));
vi.mock("./userBrainClaims.js", () => ({
  republishUserClaimsQuietly: mockRepublish,
}));

import { removeTenantMember } from "./removeTenantMember.mutation.js";
import { updateTenantMember } from "./updateTenantMember.mutation.js";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const TARGET_USER = "33333333-3333-4333-8333-333333333333";

function target(overrides: Record<string, unknown> = {}) {
  return {
    id: "member-1",
    tenant_id: TENANT_ID,
    principal_type: "user",
    principal_id: TARGET_USER,
    role: "member",
    status: "active",
    ...overrides,
  };
}

function ctx(): any {
  return { auth: { authType: "cognito", principalId: "admin-1" } };
}

beforeEach(() => {
  selectQueue.length = 0;
  txSpy.committed = false;
  txSpy.republishedDuringTx = false;
  mockRequireTenantAdmin.mockReset().mockResolvedValue("admin");
  mockResolveCaller.mockReset().mockResolvedValue({ userId: "admin-1" });
  mockRepublish.mockReset().mockResolvedValue(undefined);
});

describe("updateTenantMember", () => {
  it("republishes the claims manifest when a member leaves active", async () => {
    selectQueue.push([target()]);
    await updateTenantMember(
      null,
      { id: "member-1", input: { status: "disabled" } },
      ctx(),
    );
    expect(mockRepublish).toHaveBeenCalledWith(TENANT_ID);
    expect(txSpy.committed).toBe(true);
    expect(txSpy.republishedDuringTx).toBe(false);
  });

  it("does not republish for a plain role change", async () => {
    selectQueue.push([target()]);
    await updateTenantMember(
      null,
      { id: "member-1", input: { role: "admin" } },
      ctx(),
    );
    expect(mockRepublish).not.toHaveBeenCalled();
  });

  it("does not republish when the member was already inactive", async () => {
    selectQueue.push([target({ status: "disabled" })]);
    await updateTenantMember(
      null,
      { id: "member-1", input: { status: "suspended" } },
      ctx(),
    );
    expect(mockRepublish).not.toHaveBeenCalled();
  });
});

describe("removeTenantMember", () => {
  it("republishes the claims manifest after a member is deleted", async () => {
    selectQueue.push([target()]);
    const result = await removeTenantMember(null, { id: "member-1" }, ctx());
    expect(result).toBe(true);
    expect(mockRepublish).toHaveBeenCalledWith(TENANT_ID);
    expect(txSpy.republishedDuringTx).toBe(false);
  });

  it("does not republish when the member did not exist", async () => {
    selectQueue.push([]);
    const result = await removeTenantMember(null, { id: "member-1" }, ctx());
    expect(result).toBe(false);
    expect(mockRepublish).not.toHaveBeenCalled();
  });
});
