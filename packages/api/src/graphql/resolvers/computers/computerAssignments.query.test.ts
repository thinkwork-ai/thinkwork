import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSelect, mockRequireTenantAdmin, mockLoadComputerOrThrow } =
  vi.hoisted(() => ({
    mockSelect: vi.fn(),
    mockRequireTenantAdmin: vi.fn(),
    mockLoadComputerOrThrow: vi.fn(),
  }));

vi.mock("../../utils.js", () => ({
  db: { select: mockSelect },
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  computerAssignments: { computer_id: "computer_assignments.computer_id" },
}));

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
}));

vi.mock("./shared.js", () => ({
  loadComputerOrThrow: mockLoadComputerOrThrow,
  toGraphqlComputerAssignment: (row: Record<string, unknown>) => ({
    id: row.id,
    subjectType: String(row.subject_type).toUpperCase(),
  }),
}));

let resolver: typeof import("./computerAssignments.query.js");

beforeEach(async () => {
  vi.resetModules();
  mockSelect.mockReset();
  mockRequireTenantAdmin.mockReset();
  mockLoadComputerOrThrow.mockReset();

  mockLoadComputerOrThrow.mockResolvedValue({ id: "c1", tenant_id: "t1" });
  resolver = await import("./computerAssignments.query.js");
});

describe("computerAssignments", () => {
  it("requires tenant admin and returns assignment rows for the Computer", async () => {
    mockSelect.mockReturnValueOnce(
      queryRows([
        { id: "direct-1", subject_type: "user" },
        { id: "team-1", subject_type: "team" },
      ]),
    );

    const result = await resolver.computerAssignments(
      null,
      { computerId: "c1" },
      {} as any,
    );

    expect(mockLoadComputerOrThrow).toHaveBeenCalledWith("c1");
    expect(mockRequireTenantAdmin).toHaveBeenCalledWith({}, "t1");
    expect(result).toEqual([
      { id: "direct-1", subjectType: "USER" },
      { id: "team-1", subjectType: "TEAM" },
    ]);
  });
});

function queryRows(rows: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => Promise.resolve(rows),
  };
  return chain;
}
