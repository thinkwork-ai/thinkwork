import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("ComputerAssignmentsPanel", () => {
  const source = readSource("./ComputerAssignmentsPanel.tsx");
  const accessTableSource = readSource("./ComputerAccessUsersTable.tsx");

  it("uses the shared Computer assignment API for direct users and Teams", () => {
    expect(source).toContain("ComputerAssignmentsQuery");
    expect(source).toContain("SetComputerAssignmentsMutation");
    expect(source).toContain("TenantMembersListQuery");
    expect(source).toContain("TeamsListQuery");
    expect(source).toContain("buildComputerAssignmentTargets");
  });

  it("renders the effective access table from computerAccessUsers", () => {
    expect(accessTableSource).toContain("ComputerAccessUsersQuery");
    expect(accessTableSource).toContain("Users With Access");
    expect(accessTableSource).toContain("DataTable");
    expect(accessTableSource).toContain("accessSourceLabel");
  });
});
