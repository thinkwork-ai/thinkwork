import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockTargetRows,
  mockUpsertRows,
  mockResolveCaller,
  mockRequireTenantAdmin,
  insertCalls,
  conflictCalls,
  transactionCalls,
} = vi.hoisted(() => {
  const insertCalls: Array<Record<string, unknown>> = [];
  const conflictCalls: Array<Record<string, unknown>> = [];
  const transactionCalls: string[] = [];

  return {
    mockTargetRows: vi.fn(),
    mockUpsertRows: vi.fn(),
    mockResolveCaller: vi.fn(),
    mockRequireTenantAdmin: vi.fn(),
    insertCalls,
    conflictCalls,
    transactionCalls,
  };
});

function createDbMock() {
  const makeSelect = () => ({
    from: () => ({
      where: () => Promise.resolve(mockTargetRows() as unknown[]),
    }),
  });

  const makeInsert = () => ({
    values: (values: Record<string, unknown>) => {
      insertCalls.push(values);
      return {
        onConflictDoUpdate: (config: Record<string, unknown>) => {
          conflictCalls.push(config);
          return {
            returning: () => Promise.resolve(mockUpsertRows() as unknown[]),
          };
        },
      };
    },
  });

  return {
    select: vi.fn(makeSelect),
    insert: vi.fn(makeInsert),
    transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
      transactionCalls.push("called");
      return callback({
        select: vi.fn(makeSelect),
        insert: vi.fn(makeInsert),
      });
    }),
  };
}

vi.mock("../../utils.js", () => ({
  db: createDbMock(),
  eq: (...args: unknown[]) => ({ _eq: args }),
  and: (...args: unknown[]) => ({ _and: args }),
  agents: {
    id: "agents.id",
    tenant_id: "agents.tenant_id",
    human_pair_id: "agents.human_pair_id",
  },
  users: {
    id: "users.id",
    tenant_id: "users.tenant_id",
  },
  userProfiles: {
    user_id: "user_profiles.user_id",
  },
  snakeToCamel: (obj: Record<string, unknown>) => obj,
}));

vi.mock("./resolve-auth-user.js", () => ({
  resolveCaller: mockResolveCaller,
}));

vi.mock("./authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
}));

vi.mock("../../../lib/user-context-md-writer.js", () => ({
  writeUserContextMdForUser: vi.fn(),
}));

vi.mock("../../../lib/user-md-writer.js", () => ({
  writeUserMdForAssignment: vi.fn(),
}));

import { updateUserProfile } from "./updateUserProfile.mutation.js";

function cognitoCtx(): any {
  return {
    auth: {
      authType: "cognito",
      principalId: "sub-1",
      tenantId: null,
      email: "admin@example.com",
    },
  };
}

describe("updateUserProfile resolver", () => {
  beforeEach(() => {
    mockTargetRows.mockReset();
    mockUpsertRows.mockReset();
    mockResolveCaller.mockReset();
    mockRequireTenantAdmin.mockReset();
    insertCalls.length = 0;
    conflictCalls.length = 0;
    transactionCalls.length = 0;
  });

  it("creates the profile row when an editable user is missing one", async () => {
    mockTargetRows.mockReturnValue([{ id: "user-1", tenant_id: "tenant-1" }]);
    mockResolveCaller.mockResolvedValue({
      userId: "admin-1",
      tenantId: "tenant-1",
    });
    mockRequireTenantAdmin.mockResolvedValue("admin");
    mockUpsertRows.mockReturnValue([
      {
        id: "profile-1",
        user_id: "user-1",
        tenant_id: "tenant-1",
        display_name: "SurSum",
      },
    ]);

    const result = await updateUserProfile(
      null,
      { userId: "user-1", input: { displayName: "SurSum" } },
      cognitoCtx(),
    );

    expect(mockRequireTenantAdmin).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-1",
    );
    expect(transactionCalls).toEqual(["called"]);
    expect(insertCalls[0]).toMatchObject({
      user_id: "user-1",
      tenant_id: "tenant-1",
      display_name: "SurSum",
    });
    expect(conflictCalls[0]).toMatchObject({
      target: "user_profiles.user_id",
      set: expect.objectContaining({ display_name: "SurSum" }),
    });
    expect(result).toMatchObject({
      id: "profile-1",
      user_id: "user-1",
      display_name: "SurSum",
    });
  });
});
