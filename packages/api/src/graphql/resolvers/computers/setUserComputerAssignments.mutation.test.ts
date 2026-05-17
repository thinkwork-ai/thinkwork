import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, mockRequireTenantAdmin, mockResolveCallerUserId } = vi.hoisted(
  () => ({
    mockDb: {
      select: vi.fn(),
      transaction: vi.fn(),
    },
    mockRequireTenantAdmin: vi.fn(),
    mockResolveCallerUserId: vi.fn(),
  }),
);

vi.mock("../../utils.js", () => ({
  db: mockDb,
  and: vi.fn((...args: unknown[]) => ({ op: "and", args })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  inArray: vi.fn((column: unknown, values: unknown[]) => ({
    op: "inArray",
    column,
    values,
  })),
  users: {
    id: "users.id",
    tenant_id: "users.tenant_id",
  },
  computers: {
    id: "computers.id",
    tenant_id: "computers.tenant_id",
  },
  computerAssignments: {
    tenant_id: "computer_assignments.tenant_id",
    subject_type: "computer_assignments.subject_type",
    user_id: "computer_assignments.user_id",
  },
}));

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerUserId: mockResolveCallerUserId,
}));

vi.mock("./shared.js", () => ({
  toGraphqlComputerAssignment: (row: Record<string, unknown>) => ({
    id: row.id,
    computerId: row.computer_id,
    subjectType: String(row.subject_type).toUpperCase(),
  }),
}));

let resolver: typeof import("./setUserComputerAssignments.mutation.js");
let insertedValues: Record<string, unknown>[];

beforeEach(async () => {
  vi.resetModules();
  mockDb.select.mockReset();
  mockDb.transaction.mockReset();
  mockRequireTenantAdmin.mockReset();
  mockResolveCallerUserId.mockReset();
  insertedValues = [];

  mockResolveCallerUserId.mockResolvedValue("admin-1");
  mockDb.transaction.mockImplementation(async (fn) =>
    fn({
      delete: () => ({ where: () => Promise.resolve() }),
      insert: () => ({
        values: (values: Record<string, unknown>[]) => {
          insertedValues = values;
          return {
            returning: () =>
              Promise.resolve(
                values.map((value, index) => ({
                  id: `a${index + 1}`,
                  ...value,
                })),
              ),
          };
        },
      }),
    }),
  );

  resolver = await import("./setUserComputerAssignments.mutation.js");
});

describe("setUserComputerAssignments", () => {
  it("replaces a user's direct Computer assignments after admin gate", async () => {
    mockDb.select
      .mockReturnValueOnce(queryRows([{ id: "u1", tenant_id: "t1" }]))
      .mockReturnValueOnce(
        queryRows([
          { id: "c1", tenant_id: "t1" },
          { id: "c2", tenant_id: "t1" },
        ]),
      );

    const result = await resolver.setUserComputerAssignments(
      null,
      {
        input: {
          userId: "u1",
          computerIds: ["c1", "c2", "c1"],
          role: "operator",
        },
      },
      {} as any,
    );

    expect(mockRequireTenantAdmin).toHaveBeenCalledWith({}, "t1");
    expect(mockResolveCallerUserId).toHaveBeenCalledTimes(1);
    expect(insertedValues).toMatchObject([
      {
        tenant_id: "t1",
        computer_id: "c1",
        subject_type: "user",
        user_id: "u1",
        team_id: null,
        role: "operator",
        assigned_by_user_id: "admin-1",
      },
      {
        tenant_id: "t1",
        computer_id: "c2",
        subject_type: "user",
        user_id: "u1",
        team_id: null,
        role: "operator",
        assigned_by_user_id: "admin-1",
      },
    ]);
    expect(result).toEqual([
      { id: "a1", computerId: "c1", subjectType: "USER" },
      { id: "a2", computerId: "c2", subjectType: "USER" },
    ]);
  });

  it("rejects Computers outside the user's tenant before writing", async () => {
    mockDb.select
      .mockReturnValueOnce(queryRows([{ id: "u1", tenant_id: "t1" }]))
      .mockReturnValueOnce(queryRows([{ id: "c1", tenant_id: "t1" }]));

    await expect(
      resolver.setUserComputerAssignments(
        null,
        { input: { userId: "u1", computerIds: ["c1", "c2"] } },
        {} as any,
      ),
    ).rejects.toThrow("One or more Computers were not found in tenant");

    expect(mockDb.transaction).not.toHaveBeenCalled();
  });
});

function queryRows(rows: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(rows),
    then: (resolve: (value: unknown[]) => unknown) =>
      Promise.resolve(rows).then(resolve),
  };
  return chain;
}
