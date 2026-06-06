/**
 * Plan 2026-05-29-006 U5 (R8) — bootstrapUser stamps cognito_sub on the
 * created users row, where email (and thus the Cognito sub) is guaranteed
 * present, so a new user is linked at creation and never depends on the
 * email heal path.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, insertCalls, updateCalls, selectQueue, returningQueue } =
  vi.hoisted(() => {
    const insertCalls: Array<{
      table: string;
      values: Record<string, unknown>;
    }> = [];
    const updateCalls: Array<{
      table: string;
      values: Record<string, unknown>;
    }> = [];
    const selectQueue: unknown[][] = [];
    const returningQueue: unknown[][] = [];

    const mockDb = {
      select: vi.fn(() => {
        const chain: any = {
          from: vi.fn(() => chain),
          where: vi.fn(() => chain),
          limit: vi.fn(async () => selectQueue.shift() ?? []),
          then: (resolve: (v: unknown) => void) =>
            resolve(selectQueue.shift() ?? []),
        };
        return chain;
      }),
      insert: vi.fn((table: { __table__: string }) => ({
        values: (values: Record<string, unknown>) => {
          insertCalls.push({ table: table.__table__, values });
          const result: any = {
            returning: async () => returningQueue.shift() ?? [],
            onConflictDoNothing: () => Promise.resolve([]),
            then: (resolve: (v: unknown) => void) => resolve([]),
          };
          return result;
        },
      })),
      update: vi.fn((table: { __table__: string }) => ({
        set: vi.fn((values: Record<string, unknown>) => {
          updateCalls.push({ table: table.__table__, values });
          return {
            where: vi.fn(() => ({
              returning: async () => returningQueue.shift() ?? [],
            })),
          };
        }),
      })),
    };

    return { mockDb, insertCalls, updateCalls, selectQueue, returningQueue };
  });

vi.mock("../../utils.js", () => ({
  db: mockDb,
  eq: vi.fn((field: unknown, value: unknown) => ({ __eq: { field, value } })),
  sql: vi.fn(() => ({ __sql: true })),
  tenants: { __table__: "tenants" },
  users: { __table__: "users" },
  tenantMembers: { __table__: "tenant_members" },
  tenantSettings: { __table__: "tenant_settings" },
  agentTemplates: { __table__: "agent_templates" },
}));

vi.mock("@thinkwork/database-pg/utils/generate-slug", () => ({
  generateSlug: () => "happy-otter",
}));

vi.mock("@aws-sdk/client-cognito-identity-provider", () => ({
  CognitoIdentityProviderClient: class {
    send = async () => ({});
  },
  AdminUpdateUserAttributesCommand: class {
    constructor(public input: unknown) {}
  },
}));

import { bootstrapUser } from "./bootstrapUser.mutation.js";

beforeEach(() => {
  insertCalls.length = 0;
  updateCalls.length = 0;
  selectQueue.length = 0;
  returningQueue.length = 0;
});

describe("bootstrapUser", () => {
  it("stamps cognito_sub on the created user row (default new-tenant path)", async () => {
    selectQueue.push([]); // existing user lookup → none
    selectQueue.push([]); // pending (paid) tenant lookup → none
    returningQueue.push([{ id: "tenant-1", slug: "happy-otter" }]); // insert tenants
    returningQueue.push([{ id: "user-1", email: "new@example.com" }]); // insert users

    const result = await bootstrapUser({}, {}, {
      auth: {
        authType: "cognito",
        principalId: "sub-new",
        email: "new@example.com",
        name: "New User",
      },
      headers: {},
    } as any);

    const userInsert = insertCalls.find((c) => c.table === "users");
    expect(userInsert).toBeDefined();
    expect(userInsert?.values.cognito_sub).toBe("sub-new");
    expect(userInsert?.values.email).toBe("new@example.com");
    expect(result.isNew).toBe(true);
  });

  it("claims a pending tenant only for a verified matching email", async () => {
    selectQueue.push([]); // existing user lookup -> none
    selectQueue.push([
      {
        id: "tenant-claim",
        slug: "acme",
        plan: "pro",
        pending_owner_email: "Admin@Example.com",
        first_admin_claim_required: true,
      },
    ]);
    selectQueue.push([]); // existing users in tenant
    returningQueue.push([{ id: "user-claim", email: "admin@example.com" }]);
    returningQueue.push([
      {
        id: "tenant-claim",
        slug: "acme",
        pending_owner_email: null,
        first_admin_claim_required: false,
      },
    ]);

    const result = await bootstrapUser({}, {}, {
      auth: {
        authType: "cognito",
        principalId: "sub-claim",
        email: "admin@example.com",
        emailVerified: true,
        name: "Admin User",
      },
      headers: {},
    } as any);

    const userInsert = insertCalls.find((c) => c.table === "users");
    const memberInsert = insertCalls.find((c) => c.table === "tenant_members");
    const tenantUpdate = updateCalls.find((c) => c.table === "tenants");

    expect(userInsert?.values).toEqual(
      expect.objectContaining({
        tenant_id: "tenant-claim",
        email: "admin@example.com",
        cognito_sub: "sub-claim",
      }),
    );
    expect(memberInsert?.values).toEqual(
      expect.objectContaining({
        tenant_id: "tenant-claim",
        principal_id: "user-claim",
        role: "owner",
      }),
    );
    expect(tenantUpdate?.values).toEqual(
      expect.objectContaining({
        pending_owner_email: null,
        first_admin_claim_required: false,
        first_admin_claimed_user_id: "user-claim",
      }),
    );
    expect(result.tenant.id).toBe("tenant-claim");
    expect(result.isNew).toBe(true);
  });

  it("rejects a pending tenant claim when the matching email is not verified", async () => {
    selectQueue.push([]); // existing user lookup -> none
    selectQueue.push([
      {
        id: "tenant-claim",
        slug: "acme",
        plan: "pro",
        pending_owner_email: "admin@example.com",
        first_admin_claim_required: true,
      },
    ]);

    await expect(
      bootstrapUser({}, {}, {
        auth: {
          authType: "cognito",
          principalId: "sub-unverified",
          email: "admin@example.com",
          emailVerified: false,
          name: "Admin User",
        },
        headers: {},
      } as any),
    ).rejects.toThrow(/Verified email is required/);

    expect(insertCalls).toEqual([]);
    expect(updateCalls).toEqual([]);
  });
});
