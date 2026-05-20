import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Spaces admin routes", () => {
  const listRouteSource = readSource("./index.tsx");
  const detailRouteSource = readSource("./$spaceId.tsx");
  const queriesSource = readSource("../../../../lib/graphql-queries.ts");
  const routeTreeSource = readSource("../../../../routeTree.gen.ts");

  it("registers Spaces list and detail routes", () => {
    expect(routeTreeSource).toContain("AuthedTenantSpacesIndexRouteImport");
    expect(routeTreeSource).toContain("AuthedTenantSpacesSpaceIdRouteImport");
    expect(listRouteSource).toContain(
      'createFileRoute("/_authed/_tenant/spaces/")',
    );
    expect(detailRouteSource).toContain(
      'createFileRoute("/_authed/_tenant/spaces/$spaceId")',
    );
  });

  it("renders a Spaces data table that links to Space detail", () => {
    expect(listRouteSource).toContain("SpacesListQuery");
    expect(listRouteSource).toContain("CreateSpaceMutation");
    expect(listRouteSource).toContain("New Space");
    expect(listRouteSource).toContain("<DataTable");
    expect(listRouteSource).toContain('header: "Space"');
    expect(listRouteSource).toContain('header: "Agents"');
    expect(listRouteSource).toContain('header: "MCP"');
    expect(listRouteSource).toContain('header: "Tools"');
    expect(listRouteSource).toContain('header: "Connected Data"');
    expect(listRouteSource).toContain('to: "/spaces/$spaceId"');
    expect(listRouteSource).not.toContain("{row.original.slug}");
  });

  it("mounts Space Studio tabs around context configuration", () => {
    expect(detailRouteSource).toContain('value="overview"');
    expect(detailRouteSource).toContain('value="workspace"');
    expect(detailRouteSource).toContain('value="connected-data"');
    expect(detailRouteSource).toContain('value="tools"');
    expect(detailRouteSource).toContain('value="mcp"');
    expect(detailRouteSource).toContain('value="agents"');
    expect(detailRouteSource).toContain('value="settings"');
    expect(detailRouteSource).toContain("WorkspaceEditor");
    expect(detailRouteSource).toContain("target={{ spaceId: space.id }}");
  });

  it("does not expose retired admin collaboration tabs", () => {
    expect(detailRouteSource).not.toContain('value="threads"');
    expect(detailRouteSource).not.toContain('value="checklist"');
    expect(detailRouteSource).not.toContain('value="members"');
    expect(detailRouteSource).not.toContain('value="integrations"');
    expect(detailRouteSource).not.toContain("ThreadsPagedQuery");
    expect(detailRouteSource).not.toContain("ThreadsTable");
  });

  it("shows the contextual Space configuration surfaces", () => {
    expect(detailRouteSource).toContain("Space Prompt");
    expect(detailRouteSource).toContain("Connected Data Config");
    expect(detailRouteSource).toContain("Tool Policy");
    expect(detailRouteSource).toContain("MCP Policy");
    expect(detailRouteSource).toContain("Agent Availability");
  });

  it("queries Space configuration needed by the admin module", () => {
    expect(queriesSource).toContain("query SpacesList");
    expect(queriesSource).toContain("mutation CreateSpace");
    expect(queriesSource).toContain("query SpaceAdminDetail");
    expect(queriesSource).toContain("agentAssignments");
    expect(queriesSource).toContain("localInstructions");
    expect(queriesSource).toContain("contextConfig");
    expect(queriesSource).toContain("connectedDataConfig");
    expect(queriesSource).toContain("toolPolicy");
    expect(queriesSource).toContain("mcpPolicy");
    expect(queriesSource).toContain("mcpServers");
    expect(queriesSource).not.toContain("checklistTemplates");
    expect(queriesSource).not.toContain("integrations");
    expect(queriesSource).not.toContain("members");
  });
});
