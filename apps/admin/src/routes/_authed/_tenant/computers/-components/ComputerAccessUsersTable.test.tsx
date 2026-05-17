import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("ComputerAccessUsersTable", () => {
  const source = readSource("./ComputerAccessUsersTable.tsx");

  it("renders the single users-with-access section and owns editing", () => {
    expect(source).toContain("ComputerAccessUsersQuery");
    expect(source).toContain("Users With Access");
    expect(source).toContain("Edit Users With Access");
    expect(source).toContain("SetComputerAssignmentsMutation");
    expect(source).toContain("TenantMembersListQuery");
    expect(source).toContain("DataTable");
  });

  it("keeps Teams out of the Computer access UI", () => {
    expect(source).not.toContain("TeamsListQuery");
    expect(source).not.toContain('header: "Teams"');
    expect(source).not.toContain("selectedTeamIds");
    expect(source).toContain(
      "buildComputerAssignmentTargets(selectedUserIds, [])",
    );
  });
});
