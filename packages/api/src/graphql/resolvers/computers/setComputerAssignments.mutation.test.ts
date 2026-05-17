import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDb,
  mockRequireTenantAdmin,
  mockResolveCallerUserId,
  mockLoadComputerOrThrow,
  mockRequireTenantUser,
  mockRequireTenantTeam,
} = vi.hoisted(() => ({
  mockDb: {
    transaction: vi.fn(),
  },
  mockRequireTenantAdmin: vi.fn(),
  mockResolveCallerUserId: vi.fn(),
  mockLoadComputerOrThrow: vi.fn(),
  mockRequireTenantUser: vi.fn(),
  mockRequireTenantTeam: vi.fn(),
}));

vi.mock("../../utils.js", () => ({
  db: mockDb,
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  computerAssignments: {
    computer_id: "computer_assignments.computer_id",
    $inferInsert: {},
  },
}));

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerUserId: mockResolveCallerUserId,
}));

vi.mock("./shared.js", () => ({
  loadComputerOrThrow: mockLoadComputerOrThrow,
  parseAssignmentSubjectType: (value: string) => value.toLowerCase(),
  requireTenantTeam: mockRequireTenantTeam,
  requireTenantUser: mockRequireTenantUser,
  toGraphqlComputerAssignment: (row: Record<string, unknown>) => ({
    id: row.id,
    subjectType: String(row.subject_type).toUpperCase(),
  }),
}));

let resolver: typeof import("./setComputerAssignments.mutation.js");
let insertedValues: Record<string, unknown>[];

beforeEach(async () => {
  vi.resetModules();
  mockDb.transaction.mockReset();
  mockRequireTenantAdmin.mockReset();
  mockResolveCallerUserId.mockReset();
  mockLoadComputerOrThrow.mockReset();
  mockRequireTenantUser.mockReset();
  mockRequireTenantTeam.mockReset();
  insertedValues = [];

  mockLoadComputerOrThrow.mockResolvedValue({ id: "c1", tenant_id: "t1" });
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

  resolver = await import("./setComputerAssignments.mutation.js");
});

describe("setComputerAssignments", () => {
  it("replaces a Computer's direct and Team assignments after admin gate", async () => {
    const result = await resolver.setComputerAssignments(
      null,
      {
        input: {
          computerId: "c1",
          assignments: [
            { subjectType: "USER", userId: "u1" },
            { subjectType: "TEAM", teamId: "team-1", role: "manager" },
          ],
        },
      },
      {} as any,
    );

    expect(mockRequireTenantAdmin).toHaveBeenCalledWith({}, "t1");
    expect(mockRequireTenantUser).toHaveBeenCalledWith("t1", "u1");
    expect(mockRequireTenantTeam).toHaveBeenCalledWith("t1", "team-1");
    expect(insertedValues).toMatchObject([
      {
        tenant_id: "t1",
        computer_id: "c1",
        subject_type: "user",
        user_id: "u1",
        team_id: null,
        role: "member",
        assigned_by_user_id: "admin-1",
      },
      {
        tenant_id: "t1",
        computer_id: "c1",
        subject_type: "team",
        user_id: null,
        team_id: "team-1",
        role: "manager",
        assigned_by_user_id: "admin-1",
      },
    ]);
    expect(result).toEqual([
      { id: "a1", subjectType: "USER" },
      { id: "a2", subjectType: "TEAM" },
    ]);
  });

  it("rejects duplicate direct targets before writing", async () => {
    await expect(
      resolver.setComputerAssignments(
        null,
        {
          input: {
            computerId: "c1",
            assignments: [
              { subjectType: "USER", userId: "u1" },
              { subjectType: "USER", userId: "u1" },
            ],
          },
        },
        {} as any,
      ),
    ).rejects.toThrow("Duplicate Computer assignment target");

    expect(mockDb.transaction).not.toHaveBeenCalled();
  });
});
