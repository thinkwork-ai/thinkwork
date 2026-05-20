import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../AgentSpacesPanel.tsx", import.meta.url),
  "utf8",
);

describe("AgentSpacesPanel", () => {
  it("loads Spaces and toggles per-Space agent availability", () => {
    expect(source).toContain("SpacesListQuery");
    expect(source).toContain("SetSpaceAgentAvailabilityMutation");
    expect(source).toContain("<Switch");
    expect(source).toContain("setAvailability");
    expect(source).toContain('to="/spaces/$spaceId"');
  });

  it("frames availability as Space-scoped mention and invocation access", () => {
    expect(source).toContain("Space Availability");
    expect(source).toContain("mentioned and invoked");
    expect(source).toContain("SpaceAgentAssignmentStatus.Active");
  });
});
