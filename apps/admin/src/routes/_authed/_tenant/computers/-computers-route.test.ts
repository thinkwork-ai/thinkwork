import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Computers admin routes", () => {
  const sidebarSource = readSource("../../../../components/Sidebar.tsx");
  const commandPaletteSource = readSource(
    "../../../../components/CommandPalette.tsx",
  );
  const listRouteSource = readSource("./index.tsx");
  const detailRouteSource = readSource("./$computerId.tsx");
  const queriesSource = readSource("../../../../lib/graphql-queries.ts");

  it("exposes Computers as a primary admin surface", () => {
    expect(sidebarSource).toContain('label: "Computers"');
    expect(sidebarSource).toContain('to: "/computers"');
    expect(commandPaletteSource).toContain('label: "Computers"');
    expect(commandPaletteSource).toContain('to: "/computers"');
  });

  it("renders a Computer list with runtime and migration columns", () => {
    expect(listRouteSource).toContain("ComputersListQuery");
    expect(listRouteSource).toContain("desiredRuntimeStatus");
    expect(listRouteSource).toContain("runtimeStatus");
    expect(listRouteSource).toContain("migratedFromAgentId");
    expect(listRouteSource).toContain('to: "/computers/$computerId"');
  });

  it("renders detail panels for status, runtime, migration, and identity", () => {
    expect(detailRouteSource).toContain("WorkspaceEditor");
    expect(detailRouteSource).toContain("ComputerStatusPanel");
    expect(detailRouteSource).toContain("ComputerLiveTasksPanel");
    expect(detailRouteSource).toContain("ComputerRuntimePanel");
    expect(detailRouteSource).toContain("ComputerMigrationPanel");
    expect(detailRouteSource).toContain("Identity");
  });

  it("defines typed GraphQL documents for Computer reads and updates", () => {
    expect(queriesSource).toContain("query ComputersList");
    expect(queriesSource).toContain("query ComputerDetail");
    expect(queriesSource).toContain("query MyComputer");
    expect(queriesSource).toContain("mutation UpdateComputer");
  });
});
