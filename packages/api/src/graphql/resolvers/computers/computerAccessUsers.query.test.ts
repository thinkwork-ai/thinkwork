import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSelect, mockRequireTenantAdmin, mockLoadComputerOrThrow } =
  vi.hoisted(() => ({
    mockSelect: vi.fn(),
    mockRequireTenantAdmin: vi.fn(),
    mockLoadComputerOrThrow: vi.fn(),
  }));

vi.mock("../../utils.js", () => ({
  db: { select: mockSelect },
  and: vi.fn((...args: unknown[]) => ({ op: "and", args })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  users: { id: "users.id" },
  teams: { id: "teams.id" },
  teamUsers: {
    tenant_id: "team_users.tenant_id",
    team_id: "team_users.team_id",
    user_id: "team_users.user_id",
  },
  computerAssignments: {
    tenant_id: "computer_assignments.tenant_id",
    computer_id: "computer_assignments.computer_id",
    subject_type: "computer_assignments.subject_type",
    user_id: "computer_assignments.user_id",
    team_id: "computer_assignments.team_id",
  },
  snakeToCamel: (row: Record<string, unknown>) => row,
}));

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
}));

vi.mock("./shared.js", () => ({
  accessSource: ({ direct, team }: { direct: boolean; team: boolean }) =>
    direct && team ? "BOTH" : team ? "TEAM" : "DIRECT",
  loadComputerOrThrow: mockLoadComputerOrThrow,
  toGraphqlComputerAssignment: (row: Record<string, unknown>) => ({
    id: row.id,
    subjectType: String(row.subject_type).toUpperCase(),
  }),
}));

let resolver: typeof import("./computerAccessUsers.query.js");

beforeEach(async () => {
  vi.resetModules();
  mockSelect.mockReset();
  mockRequireTenantAdmin.mockReset();
  mockLoadComputerOrThrow.mockReset();
  mockLoadComputerOrThrow.mockResolvedValue({ id: "c1", tenant_id: "t1" });
  resolver = await import("./computerAccessUsers.query.js");
});

describe("computerAccessUsers", () => {
  it("returns effective users with direct, Team, and combined source metadata", async () => {
    mockSelect
      .mockReturnValueOnce(
        queryRows([
          {
            users: { id: "u1", email: "u1@example.com" },
            computer_assignments: {
              id: "a-direct",
              subject_type: "user",
            },
          },
        ]),
      )
      .mockReturnValueOnce(
        queryRows([
          {
            users: { id: "u1", email: "u1@example.com" },
            teams: { id: "team-1", name: "Sales" },
            computer_assignments: { id: "a-team-1", subject_type: "team" },
          },
          {
            users: { id: "u2", email: "u2@example.com" },
            teams: { id: "team-1", name: "Sales" },
            computer_assignments: { id: "a-team-1", subject_type: "team" },
          },
        ]),
      );

    const result = await resolver.computerAccessUsers(
      null,
      { computerId: "c1" },
      {} as any,
    );

    expect(mockRequireTenantAdmin).toHaveBeenCalledWith({}, "t1");
    expect(result).toEqual([
      {
        userId: "u1",
        user: { id: "u1", email: "u1@example.com" },
        accessSource: "BOTH",
        directAssignment: { id: "a-direct", subjectType: "USER" },
        teamAssignments: [{ id: "a-team-1", subjectType: "TEAM" }],
        teams: [{ id: "team-1", name: "Sales" }],
      },
      {
        userId: "u2",
        user: { id: "u2", email: "u2@example.com" },
        accessSource: "TEAM",
        directAssignment: null,
        teamAssignments: [{ id: "a-team-1", subjectType: "TEAM" }],
        teams: [{ id: "team-1", name: "Sales" }],
      },
    ]);
  });
});

function queryRows(rows: unknown[]) {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => Promise.resolve(rows),
  };
  return chain;
}
