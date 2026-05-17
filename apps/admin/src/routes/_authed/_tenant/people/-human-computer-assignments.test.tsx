import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("People detail Computer assignments", () => {
  const routeSource = readSource("./$humanId.tsx");
  const sectionSource = readSource(
    "../../../../components/humans/HumanComputerAssignmentsSection.tsx",
  );

  it("mounts Computer assignment controls on People detail", () => {
    expect(routeSource).toContain("HumanComputerAssignmentsSection");
    expect(routeSource).not.toContain("ComputerFormDialog");
    expect(routeSource).not.toContain("ownerLocked");
  });

  it("replaces direct user assignments without managing personal Computers", () => {
    expect(sectionSource).toContain("UserComputerAssignmentsQuery");
    expect(sectionSource).toContain("ComputersListQuery");
    expect(sectionSource).toContain("SetUserComputerAssignmentsMutation");
    expect(sectionSource).toContain("computerIds: selectedComputerIds");
    expect(sectionSource).toContain("accessSourceLabel");
  });
});
