/**
 * Plan 2026-05-29-006 U5 (R8) — bootstrapUser stamps cognito_sub on the
 * created users row, where email (and thus the Cognito sub) is guaranteed
 * present, so a new user is linked at creation and never depends on the
 * email heal path.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, insertCalls, selectQueue, returningQueue } = vi.hoisted(() => {
  const insertCalls: Array<{ table: string; values: Record<string, unknown> }> =
    [];
  const selectQueue: unknown[][] = [];
  const returningQueue: unknown[][] = [];

  const mockDb = {
    select: vi.fn(() => {
      const chain: any = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        limit: vi.fn(async () => selectQueue.shift() ?? []),
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
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({ returning: async () => [] })),
      })),
    })),
  };

  return { mockDb, insertCalls, selectQueue, returningQueue };
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
});
