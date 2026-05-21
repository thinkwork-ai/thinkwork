import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Spaces admin routes", () => {
  const listRouteSource = readSource("./index.tsx");
  const detailRouteSource = readSource("./$spaceId.tsx");
  const detailChromeSource = readSource(
    "../../../../components/spaces/SpaceDetailChrome.tsx",
  );
  const workspaceRouteSource = readSource("./$spaceId_.workspace.tsx");
  const connectedDataRouteSource = readSource("./$spaceId_.connected-data.tsx");
  const toolsRouteSource = readSource("./$spaceId_.tools.tsx");
  const mcpRouteSource = readSource("./$spaceId_.mcp.tsx");
  const settingsRouteSource = readSource("./$spaceId_.settings.tsx");
  const queriesSource = readSource("../../../../lib/graphql-queries.ts");
  const routeTreeSource = readSource("../../../../routeTree.gen.ts");

  it("registers Spaces list and detail routes", () => {
    expect(routeTreeSource).toContain("AuthedTenantSpacesIndexRouteImport");
    expect(routeTreeSource).toContain("AuthedTenantSpacesSpaceIdRouteImport");
    expect(routeTreeSource).toContain(
      "AuthedTenantSpacesSpaceIdWorkspaceRouteImport",
    );
    expect(routeTreeSource).toContain(
      "AuthedTenantSpacesSpaceIdConnectedDataRouteImport",
    );
    expect(routeTreeSource).toContain(
      "AuthedTenantSpacesSpaceIdToolsRouteImport",
    );
    expect(routeTreeSource).toContain(
      "AuthedTenantSpacesSpaceIdMcpRouteImport",
    );
    expect(routeTreeSource).toContain(
      "AuthedTenantSpacesSpaceIdSettingsRouteImport",
    );
    expect(listRouteSource).toContain(
      'createFileRoute("/_authed/_tenant/spaces/")',
    );
    expect(detailRouteSource).toContain(
      'createFileRoute("/_authed/_tenant/spaces/$spaceId")',
    );
    expect(workspaceRouteSource).toContain(
      'createFileRoute(\n  "/_authed/_tenant/spaces/$spaceId_/workspace"',
    );
    expect(connectedDataRouteSource).toContain(
      '"/_authed/_tenant/spaces/$spaceId_/connected-data"',
    );
    expect(toolsRouteSource).toContain(
      '"/_authed/_tenant/spaces/$spaceId_/tools"',
    );
    expect(mcpRouteSource).toContain(
      '"/_authed/_tenant/spaces/$spaceId_/mcp"',
    );
    expect(settingsRouteSource).toContain(
      '"/_authed/_tenant/spaces/$spaceId_/settings"',
    );
  });

  it("renders a Spaces data table that links to Space detail", () => {
    expect(listRouteSource).toContain("SpacesListQuery");
    expect(listRouteSource).toContain("CreateSpaceMutation");
    expect(listRouteSource).toContain("New Space");
    expect(listRouteSource).toContain("<DataTable");
    expect(listRouteSource).toContain('header: "Space"');
    expect(listRouteSource).toContain('header: "Access"');
    expect(listRouteSource).toContain('header: "Agents"');
    expect(listRouteSource).toContain('header: "MCP"');
    expect(listRouteSource).toContain('header: "Tools"');
    expect(listRouteSource).toContain('header: "Connected Data"');
    expect(listRouteSource).toContain('to: "/spaces/$spaceId/workspace"');
    expect(listRouteSource).not.toContain("{row.original.slug}");
  });

  it("mounts route-backed Space Studio tabs around context configuration", () => {
    expect(detailChromeSource).not.toContain('value="overview"');
    expect(detailChromeSource).toContain('value="workspace"');
    expect(detailChromeSource).toContain('value="connected-data"');
    expect(detailChromeSource).toContain('value="tools"');
    expect(detailChromeSource).toContain('value="mcp"');
    expect(detailChromeSource).not.toContain('value="agents"');
    expect(detailChromeSource).toContain('value="settings"');
    expect(detailChromeSource).toContain("<TabsList>");
    expect(detailChromeSource).not.toContain('variant="line"');
    expect(detailChromeSource).toContain("asChild");
    expect(detailChromeSource).toContain('to="/spaces/$spaceId/workspace"');
    expect(detailChromeSource).toContain(
      'to="/spaces/$spaceId/connected-data"',
    );
    expect(detailChromeSource).toContain('to="/spaces/$spaceId/settings"');
    expect(workspaceRouteSource).toContain("SpaceWorkspacePanel");
    expect(detailChromeSource).toContain("target={{ spaceId }}");
    expect(detailChromeSource).not.toContain('className="h-4 w-4"');
  });

  it("does not expose retired admin collaboration tabs", () => {
    expect(detailChromeSource).not.toContain('value="threads"');
    expect(detailChromeSource).not.toContain('value="checklist"');
    expect(detailChromeSource).not.toContain('value="members"');
    expect(detailChromeSource).not.toContain('value="integrations"');
    expect(detailChromeSource).not.toContain("ThreadsPagedQuery");
    expect(detailChromeSource).not.toContain("ThreadsTable");
  });

  it("keeps the Space detail header compact", () => {
    expect(detailChromeSource).toContain(
      'className="min-w-0 truncate text-2xl font-bold leading-tight tracking-tight text-foreground"',
    );
    expect(detailChromeSource).not.toContain("relativeTime");
    expect(detailChromeSource).not.toContain(
      '<Badge variant="outline">{formatLabel(space.kind)}</Badge>',
    );
    expect(detailChromeSource).not.toContain(
      '<Badge variant="outline">{formatLabel(space.accessMode)}</Badge>',
    );
    expect(detailChromeSource).not.toContain("Updated {relativeTime");
  });

  it("shows the contextual Space configuration surfaces", () => {
    expect(detailChromeSource).toContain("Connected Data Config");
    expect(detailChromeSource).toContain("Tool Policy");
    expect(detailChromeSource).toContain("MCP Policy");
    expect(detailChromeSource).toContain("Agent Availability");
    expect(detailChromeSource).toContain("Access");
    expect(detailChromeSource).toContain("Save");
  });

  it("queries Space configuration needed by the admin module", () => {
    expect(queriesSource).toContain("query SpacesList");
    expect(queriesSource).toContain("mutation CreateSpace");
    expect(queriesSource).toContain("mutation UpdateSpace");
    expect(queriesSource).toContain("query SpaceAdminDetail");
    expect(queriesSource).toContain("includeAllForAdmin: true");
    expect(queriesSource).toContain("accessMode");
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
