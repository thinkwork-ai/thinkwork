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
  const mainSource = readSource("../../../../main.tsx");
  const listRouteSource = readSource("./index.tsx");
  const detailRouteSource = readSource("./$computerId.tsx");
  const queriesSource = readSource("../../../../lib/graphql-queries.ts");

  it("exposes Computers as a primary admin surface", () => {
    expect(sidebarSource).toContain('label: "Computers"');
    expect(sidebarSource).toContain('to: "/computers"');
    expect(commandPaletteSource).toContain('label: "Computers"');
    expect(commandPaletteSource).toContain('to: "/computers"');
  });

  it("places Computers first under Agentic OS instead of the top work group", () => {
    expect(sidebarSource).toContain("<SidebarGroupLabel>Agentic OS");
    expect(sidebarSource).not.toContain("<SidebarGroupLabel>Managed Harness");
    const workItemsStart = sidebarSource.indexOf(
      "const workItems: NavItem[] = [",
    );
    const automationsItemsStart = sidebarSource.indexOf(
      "const automationsItems: NavItem[] = [",
    );
    const agentsItemsStart = sidebarSource.indexOf(
      "const agentsItems: NavItem[] = [",
    );
    const workItemsSource = sidebarSource.slice(
      workItemsStart,
      automationsItemsStart,
    );
    const agentsItemsSource = sidebarSource.slice(agentsItemsStart);

    expect(agentsItemsSource).toMatch(/=\s*\[\s*\{\s*to: "\/computers"/);
    expect(workItemsSource).toContain('label: "Dashboard"');
    expect(workItemsSource).toContain('label: "Threads"');
    expect(workItemsSource).not.toContain('to: "/computers"');
  });

  it("counts only non-archived Computers in the sidebar badge", () => {
    expect(sidebarSource).toContain('computer.status !== "ARCHIVED"');
  });

  it("does not register the Symphony extension at admin startup", () => {
    expect(mainSource).not.toContain(
      "./extensions/configured-external-extension",
    );
  });

  it("renders a Computer list that links to detail pages", () => {
    expect(listRouteSource).toContain("ComputersListQuery");
    expect(listRouteSource).toContain('to: "/computers/$computerId"');
    expect(listRouteSource).toContain('header: "Access"');
    expect(listRouteSource).toContain('"Shared"');
    // Runtime + Migration columns were dropped from the list view; they
    // remain on the Computer Detail page where they have room to breathe.
    expect(listRouteSource).not.toContain('header: "Runtime"');
    expect(listRouteSource).not.toContain('header: "Migration"');
    expect(listRouteSource).not.toContain('header: "Owner"');
  });

  it("renders the post-cleanup Detail page (Dashboard | Workspace | Terminal | Config)", () => {
    expect(detailRouteSource).toContain("WorkspaceEditor");
    expect(detailRouteSource).toContain("ComputerWorkspaceTab");
    expect(detailRouteSource).toContain("useMemo(() => ({ computerId })");
    expect(detailRouteSource).toContain('mode="computer"');
    expect(detailRouteSource).not.toContain("target={{ agentId:");
    // Tab order: Dashboard | Workspace | Terminal | Config (plan U3).
    expect(detailRouteSource).toContain(
      'type ComputerDetailTab = "dashboard" | "workspace" | "terminal" | "config"',
    );
    expect(detailRouteSource).toContain('value="dashboard"');
    expect(detailRouteSource).toContain('value="workspace"');
    expect(detailRouteSource).toContain('value="terminal"');
    expect(detailRouteSource).toContain('value="config"');
    expect(detailRouteSource).toContain("ComputerTerminal");
    expect(detailRouteSource).toContain("ComputerStatusPanel");
    expect(detailRouteSource).toContain("ComputerDashboardMetrics");
    expect(detailRouteSource).toContain("ComputerRuntimePanel");
    expect(detailRouteSource).toContain("ComputerAccessUsersTable");
    expect(detailRouteSource).not.toContain("ComputerAssignmentsPanel");
    expect(detailRouteSource).toContain("Identity");
    // Panels removed by plan U2 must not have crept back in.
    expect(detailRouteSource).not.toContain("ComputerDashboardActivity");
    expect(detailRouteSource).not.toContain("ComputerLiveTasksPanel");
    expect(detailRouteSource).not.toContain("ComputerEventsPanel");
    expect(detailRouteSource).not.toContain("ComputerMigrationPanel");
    expect(detailRouteSource).not.toContain(
      "xl:grid-cols-[minmax(0,1fr)_420px]",
    );
  });

  it("wires the shared ThreadsTable on the Computer Dashboard (plan U7)", () => {
    expect(detailRouteSource).toContain(
      'from "@/components/threads/ThreadsTable"',
    );
    expect(detailRouteSource).toContain("ThreadsPagedQuery");
    expect(detailRouteSource).toContain("computerId: computer.id");
    expect(detailRouteSource).toContain('scope="computer"');
    expect(detailRouteSource).toContain("PAGE_SIZE = 10");
    expect(detailRouteSource).toContain("Recent Threads");
  });

  it("Workspace tab is height-capped (plan U8: no double-scroll)", () => {
    expect(detailRouteSource).toContain("ComputerWorkspaceTab");
    expect(detailRouteSource).toContain("h-[calc(100vh-220px)]");
    // No remaining bare min-h-[650px] for the Workspace container.
    expect(detailRouteSource).not.toMatch(
      /ComputerWorkspaceTab[\s\S]{0,400}min-h-\[650px\]/,
    );
  });

  it("Archive lives in Config → Computer Status, not in the page header (plan U4)", () => {
    const statusPanelSource = readSource(
      "./-components/ComputerStatusPanel.tsx",
    );
    expect(statusPanelSource).toContain("Archive");
    expect(statusPanelSource).toContain("ComputerStatus.Archived");
    // The page-header ArchiveAction was deleted; only the Computer Status
    // panel hosts it now. The detail route imports may reference
    // ComputerStatus enum for other purposes, so we only assert the
    // ArchiveAction symbol does not appear at the route level.
    expect(detailRouteSource).not.toContain("function ArchiveAction");
  });

  it("retires the queries that backed the deleted panels (plan U2)", () => {
    expect(queriesSource).toContain("query ComputersList");
    expect(queriesSource).toContain("query ComputerDetail");
    expect(queriesSource).toContain("query ComputerAccessUsers");
    expect(queriesSource).toContain("query UserComputerAssignments");
    expect(queriesSource).toContain("mutation SetComputerAssignments");
    expect(queriesSource).toContain("mutation SetUserComputerAssignments");
    expect(queriesSource).toContain("mutation UpdateComputer");
    expect(queriesSource).not.toContain("export const MyComputerQuery");
    // ComputerTasksQuery / ComputerThreadsQuery / ComputerEventsQuery were
    // the panels' only consumers and are retired alongside them.
    expect(queriesSource).not.toContain("export const ComputerTasksQuery");
    expect(queriesSource).not.toContain("export const ComputerThreadsQuery");
    expect(queriesSource).not.toContain("export const ComputerEventsQuery");
  });
});
