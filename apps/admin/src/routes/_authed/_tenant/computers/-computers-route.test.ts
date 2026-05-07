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
  const liveTasksPanelSource = readSource(
    "./-components/ComputerLiveTasksPanel.tsx",
  );
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
    expect(detailRouteSource).toContain(
      'type ComputerDetailTab = "dashboard" | "workspace" | "config"',
    );
    expect(detailRouteSource).toContain('value="dashboard"');
    expect(detailRouteSource).toContain('value="workspace"');
    expect(detailRouteSource).toContain('value="config"');
    expect(detailRouteSource).toContain("ComputerStatusPanel");
    expect(detailRouteSource).toContain("ComputerLiveTasksPanel");
    expect(detailRouteSource).toContain("ComputerEventsPanel");
    expect(detailRouteSource).toContain("activityRefreshKey");
    expect(detailRouteSource).toContain("ComputerRuntimePanel");
    expect(detailRouteSource).toContain("ComputerMigrationPanel");
    expect(detailRouteSource).toContain("Identity");
  });

  it("offers browser-triggered runtime actions", () => {
    expect(liveTasksPanelSource).toContain("ComputerTaskType.HealthCheck");
    expect(liveTasksPanelSource).toContain(
      "ComputerTaskType.WorkspaceFileWrite",
    );
    expect(liveTasksPanelSource).toContain("ComputerTaskType.GoogleCliSmoke");
    expect(liveTasksPanelSource).toContain(
      "ComputerTaskType.GoogleWorkspaceAuthCheck",
    );
    expect(liveTasksPanelSource).toContain(
      "ComputerTaskType.GoogleCalendarUpcoming",
    );
    expect(liveTasksPanelSource).toContain("Google Calendar token unavailable");
    expect(liveTasksPanelSource).toContain(".thinkwork/runtime-checks/");
    expect(liveTasksPanelSource).not.toContain("GOOGLE_WORKSPACE_CLI_TOKEN");
    expect(liveTasksPanelSource).not.toContain("accessToken");
  });

  it("defines typed GraphQL documents for Computer reads and updates", () => {
    expect(queriesSource).toContain("query ComputersList");
    expect(queriesSource).toContain("query ComputerDetail");
    expect(queriesSource).toContain("sourceAgent");
    expect(queriesSource).toContain("query MyComputer");
    expect(queriesSource).toContain("query ComputerEvents");
    expect(queriesSource).toContain("mutation UpdateComputer");
  });
});
