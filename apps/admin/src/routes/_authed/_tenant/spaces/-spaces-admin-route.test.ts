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
  const configurationRouteSource = readSource("./$spaceId_.configuration.tsx");
  const workspaceRouteSource = readSource("./$spaceId_.workspace.tsx");
  const toolsRouteSource = readSource("./$spaceId_.tools.tsx");
  const memoryRouteSource = readSource("./$spaceId_.memory.tsx");
  const automationsRouteSource = readSource("./$spaceId_.automations.tsx");
  const queriesSource = readSource("../../../../lib/graphql-queries.ts");
  const routeTreeSource = readSource("../../../../routeTree.gen.ts");

  it("registers the simplified Space Studio routes", () => {
    expect(routeTreeSource).toContain("AuthedTenantSpacesIndexRouteImport");
    expect(routeTreeSource).toContain("AuthedTenantSpacesSpaceIdRouteImport");
    expect(routeTreeSource).toContain(
      "AuthedTenantSpacesSpaceIdConfigurationRouteImport",
    );
    expect(routeTreeSource).toContain(
      "AuthedTenantSpacesSpaceIdWorkspaceRouteImport",
    );
    expect(routeTreeSource).toContain(
      "AuthedTenantSpacesSpaceIdToolsRouteImport",
    );
    expect(routeTreeSource).toContain(
      "AuthedTenantSpacesSpaceIdMemoryRouteImport",
    );
    expect(routeTreeSource).toContain(
      "AuthedTenantSpacesSpaceIdAutomationsRouteImport",
    );
    expect(routeTreeSource).not.toContain(
      "AuthedTenantSpacesSpaceIdConnectedDataRouteImport",
    );
    expect(routeTreeSource).not.toContain(
      "AuthedTenantSpacesSpaceIdMcpRouteImport",
    );
    expect(routeTreeSource).not.toContain(
      "AuthedTenantSpacesSpaceIdSettingsRouteImport",
    );
    expect(listRouteSource).toContain(
      'createFileRoute("/_authed/_tenant/spaces/")',
    );
    expect(detailRouteSource).toContain(
      'createFileRoute("/_authed/_tenant/spaces/$spaceId")',
    );
    expect(configurationRouteSource).toContain(
      '"/_authed/_tenant/spaces/$spaceId_/configuration"',
    );
    expect(workspaceRouteSource).toContain(
      'createFileRoute(\n  "/_authed/_tenant/spaces/$spaceId_/workspace"',
    );
    expect(toolsRouteSource).toContain(
      '"/_authed/_tenant/spaces/$spaceId_/tools"',
    );
    expect(memoryRouteSource).toContain(
      '"/_authed/_tenant/spaces/$spaceId_/memory"',
    );
    expect(automationsRouteSource).toContain(
      '"/_authed/_tenant/spaces/$spaceId_/automations"',
    );
  });

  it("renders a compact Spaces table that opens Configuration", () => {
    expect(listRouteSource).toContain("SpacesListQuery");
    expect(listRouteSource).toContain("CreateSpaceMutation");
    expect(listRouteSource).toContain("New Space");
    expect(listRouteSource).toContain("<DataTable");
    expect(listRouteSource).toContain('header: "Space"');
    expect(listRouteSource).toContain('header: "Access"');
    expect(listRouteSource).toContain('header: "Status"');
    expect(listRouteSource).toContain('header: "Updated"');
    expect(listRouteSource).not.toContain(
      "Configure contextual workrooms: workspace files, connected data, tools, MCP servers, and agent availability.",
    );
    expect(listRouteSource).not.toContain('header: "Kind"');
    expect(listRouteSource).not.toContain('header: "Agents"');
    expect(listRouteSource).not.toContain('header: "MCP"');
    expect(listRouteSource).not.toContain('header: "Tools"');
    expect(listRouteSource).not.toContain('header: "Connected Data"');
    expect(listRouteSource).toContain('to: "/spaces/$spaceId/configuration"');
    expect(listRouteSource).not.toContain("{row.original.slug}");
  });

  it("mounts Space Studio tabs in the target order", () => {
    const tabOrder = [
      'value="configuration"',
      'value="workspace"',
      'value="tools"',
      'value="memory"',
      'value="automations"',
    ];

    for (const tab of tabOrder) {
      expect(detailChromeSource).toContain(tab);
    }

    for (let index = 1; index < tabOrder.length; index += 1) {
      expect(detailChromeSource.indexOf(tabOrder[index])).toBeGreaterThan(
        detailChromeSource.indexOf(tabOrder[index - 1]),
      );
    }

    expect(detailChromeSource).toContain("<TabsList>");
    expect(detailChromeSource).toContain("asChild");
    expect(detailChromeSource).toContain('to="/spaces/$spaceId/configuration"');
    expect(detailChromeSource).toContain('to="/spaces/$spaceId/workspace"');
    expect(detailChromeSource).toContain('to="/spaces/$spaceId/tools"');
    expect(detailChromeSource).toContain('to="/spaces/$spaceId/memory"');
    expect(detailChromeSource).toContain('to="/spaces/$spaceId/automations"');
    expect(detailRouteSource).toContain('to="/spaces/$spaceId/configuration"');
    expect(workspaceRouteSource).toContain("SpaceWorkspacePanel");
    expect(detailChromeSource).toContain("target={{ spaceId }}");
  });

  it("does not expose retired Space detail tabs or raw configuration panels", () => {
    expect(detailChromeSource).not.toContain('value="connected-data"');
    expect(detailChromeSource).not.toContain('value="mcp"');
    expect(detailChromeSource).not.toContain('value="settings"');
    expect(detailChromeSource).not.toContain('value="threads"');
    expect(detailChromeSource).not.toContain('value="checklist"');
    expect(detailChromeSource).not.toContain('value="members"');
    expect(detailChromeSource).not.toContain('value="integrations"');
    expect(detailChromeSource).not.toContain("Context Config");
    expect(detailChromeSource).not.toContain("Connected Data Config");
    expect(detailChromeSource).not.toContain("Tool Policy");
    expect(detailChromeSource).not.toContain("MCP Policy");
    expect(detailChromeSource).not.toContain("Agent Availability");
    expect(detailChromeSource).not.toContain("Trigger Config");
    expect(detailChromeSource).not.toContain("Raw Config");
    expect(detailChromeSource).not.toContain(">Slug<");
    expect(detailChromeSource).not.toContain("Category");
    expect(detailChromeSource).not.toContain("Created");
    expect(detailChromeSource).not.toContain("JsonPanel");
    expect(detailChromeSource).not.toContain("InfoPanel");
  });

  it("keeps Configuration focused on editable user-facing fields", () => {
    expect(detailChromeSource).toContain("SpaceConfigurationPanel");
    expect(detailChromeSource).toContain("Name");
    expect(detailChromeSource).toContain("Description");
    expect(detailChromeSource).toContain("Access");
    expect(detailChromeSource).toContain("Save");
    expect(detailChromeSource).not.toContain("space.slug");
    expect(detailChromeSource).not.toContain("space.kind");
    expect(detailChromeSource).not.toContain("space.status");
    expect(detailChromeSource).not.toContain("space.createdAt");
  });

  it("keeps Memory scoped to knowledge-base selection", () => {
    expect(memoryRouteSource).toContain("SpaceMemoryPanel");
    expect(detailChromeSource).toContain("MultiSelect");
    expect(detailChromeSource).toContain("KnowledgeBasesListQuery");
    expect(detailChromeSource).toContain("SpaceMemoryQuery");
    expect(detailChromeSource).toContain("SetSpaceKnowledgeBasesMutation");
    expect(detailChromeSource).toContain("Choose knowledge bases");
    expect(detailChromeSource).toContain("No knowledge bases selected.");
    expect(detailChromeSource).not.toContain("Hindsight");
    expect(detailChromeSource).not.toContain("Wiki");
    expect(detailChromeSource).not.toContain("MemoryRecord");
    expect(detailChromeSource).not.toContain("source adapter");
  });

  it("keeps Tools scoped to built-in tools and MCP server selection", () => {
    expect(toolsRouteSource).toContain("SpaceToolsPanel");
    expect(toolsRouteSource).toContain("space={space}");
    expect(detailChromeSource).toContain("SpaceToolsQuery");
    expect(detailChromeSource).toContain("SetSpaceToolsMutation");
    expect(detailChromeSource).toContain("listBuiltinTools");
    expect(detailChromeSource).toContain("listMcpServers");
    expect(detailChromeSource).toContain("Built-in Tools");
    expect(detailChromeSource).toContain("MCP Servers");
    expect(detailChromeSource).toContain("Choose built-in tools");
    expect(detailChromeSource).toContain("Choose MCP servers");
    expect(detailChromeSource).toContain("No tools selected.");
    expect(detailChromeSource).not.toContain("Tool Policy");
    expect(detailChromeSource).not.toContain("MCP Policy");
    expect(detailChromeSource).not.toContain("JsonPanel");
  });

  it("queries only the Space fields needed by the simplified UI", () => {
    expect(queriesSource).toContain("query SpacesList");
    expect(queriesSource).toContain("mutation CreateSpace");
    expect(queriesSource).toContain("mutation UpdateSpace");
    expect(queriesSource).toContain("query SpaceAdminDetail");
    expect(queriesSource).toContain("query SpaceMemory");
    expect(queriesSource).toContain("mutation SetSpaceKnowledgeBases");
    expect(queriesSource).toContain("query SpaceTools");
    expect(queriesSource).toContain("mutation SetSpaceTools");
    expect(queriesSource).toContain("includeAllForAdmin: true");
    expect(queriesSource).toContain("accessMode");
    expect(queriesSource).toContain("knowledgeBases");
    expect(queriesSource).toContain("knowledgeBaseId");
    expect(queriesSource).toContain("setSpaceKnowledgeBases");
    expect(queriesSource).toContain("builtInTools");
    expect(queriesSource).toContain("mcpServers");
    expect(queriesSource).toContain("mcpServerId");
    expect(queriesSource).toContain("setSpaceTools");
    expect(queriesSource).not.toContain("agentAssignments");
    expect(queriesSource).not.toContain("localInstructions");
    expect(queriesSource).not.toContain("contextConfig");
    expect(queriesSource).not.toContain("connectedDataConfig");
    expect(queriesSource).not.toContain("toolPolicy");
    expect(queriesSource).not.toContain("mcpPolicy");
    expect(queriesSource).not.toContain("agentAvailabilityPolicy");
    expect(queriesSource).not.toContain("triggerConfig");
    expect(queriesSource).not.toContain("renderDiagnostics");
    expect(queriesSource).not.toContain("checklistTemplates");
    expect(queriesSource).not.toContain("integrations");
    expect(queriesSource).not.toContain("members");
  });
});
