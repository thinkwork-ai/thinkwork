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
    expect(routeTreeSource).not.toContain(
      "AuthedTenantSpacesSpaceIdToolsRouteImport",
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
    expect(memoryRouteSource).toContain(
      '"/_authed/_tenant/spaces/$spaceId_/memory"',
    );
    expect(automationsRouteSource).toContain(
      '"/_authed/_tenant/spaces/$spaceId_/automations"',
    );
    expect(automationsRouteSource).toContain("SpaceAutomationsPanel");
    expect(automationsRouteSource).toContain("space={space}");
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
    expect(detailChromeSource).toContain('to="/spaces/$spaceId/memory"');
    expect(detailChromeSource).toContain('to="/spaces/$spaceId/automations"');
    expect(detailChromeSource).toMatch(/>\s*Workspace\s*<\/Link>/);
    expect(detailChromeSource).not.toMatch(/>\s*Files\s*<\/Link>/);
    expect(detailRouteSource).toContain('to="/spaces/$spaceId/configuration"');
    expect(workspaceRouteSource).toContain("SpaceWorkspacePanel");
    expect(detailChromeSource).toContain("target={{ spaceId }}");
  });

  it("does not expose retired Space detail tabs or raw configuration panels", () => {
    expect(detailChromeSource).not.toContain('value="connected-data"');
    expect(detailChromeSource).not.toContain('value="mcp"');
    expect(detailChromeSource).not.toContain('value="settings"');
    expect(detailChromeSource).not.toContain('value="tools"');
    expect(detailChromeSource).not.toContain('to="/spaces/$spaceId/tools"');
    expect(detailChromeSource).not.toContain('value="threads"');
    expect(detailChromeSource).not.toContain('value="checklist"');
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
    expect(detailChromeSource).not.toContain("Advanced runtime");
    expect(detailChromeSource).not.toContain("Model override");
    expect(detailChromeSource).not.toContain("Guardrail ID");
    expect(detailChromeSource).not.toContain("Monthly budget cents");
    expect(detailChromeSource).not.toContain("Budget paused");
    expect(detailChromeSource).not.toContain("Sandbox");
    expect(detailChromeSource).not.toContain("SetSpaceRuntimeOverrides");
    expect(detailChromeSource).not.toContain("RuntimeOverrideSwitch");
  });

  it("keeps Configuration focused on editable user-facing fields", () => {
    expect(detailChromeSource).toContain("SpaceConfigurationPanel");
    expect(detailChromeSource).toContain("Name");
    expect(detailChromeSource).toContain("Instructions");
    expect(detailChromeSource).not.toContain(">Description<");
    expect(detailChromeSource).toContain("Access");
    expect(detailChromeSource).toContain("SpaceEmailTriggersToggle");
    expect(detailChromeSource).toContain("emailTriggersEnabled");
    expect(detailChromeSource).toContain("Save");
    expect(detailChromeSource).not.toContain("space.kind");
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

  it("does not expose the retired Space Tools UI", () => {
    expect(detailChromeSource).not.toContain("SpaceToolsPanel");
    expect(detailChromeSource).not.toContain("SpaceToolsQuery");
    expect(detailChromeSource).not.toContain("SetSpaceToolsMutation");
    expect(detailChromeSource).not.toContain("listBuiltinTools");
    expect(detailChromeSource).not.toContain("listMcpServers");
    expect(detailChromeSource).not.toContain("Built-in Tools");
    expect(detailChromeSource).not.toContain("MCP Servers");
    expect(detailChromeSource).not.toContain("Choose built-in tools");
    expect(detailChromeSource).not.toContain("Choose MCP servers");
    expect(detailChromeSource).not.toContain("No tools selected.");
    expect(detailChromeSource).not.toContain("Tool Policy");
    expect(detailChromeSource).not.toContain("MCP Policy");
    expect(detailChromeSource).not.toContain("JsonPanel");
  });

  it("renders Space Automations as a scoped schedules and webhooks table", () => {
    expect(detailChromeSource).toContain("SpaceAutomationsPanel");
    expect(detailChromeSource).toContain("/api/scheduled-jobs?");
    expect(detailChromeSource).toContain("/api/webhooks?");
    expect(detailChromeSource).toContain(
      "new URLSearchParams({ spaceId: space.id })",
    );
    expect(detailChromeSource).toContain("<DataTable");
    expect(detailChromeSource).toContain("ScheduledJobFormDialog");
    expect(detailChromeSource).toContain("WebhookFormDialog");
    expect(detailChromeSource).toContain("Add Schedule");
    expect(detailChromeSource).toContain("Add Webhook");
    expect(detailChromeSource).toContain(
      "JSON.stringify({ ...data, spaceId: space.id })",
    );
    expect(detailChromeSource).toContain('header: "Name"');
    expect(detailChromeSource).toContain('header: "Type"');
    expect(detailChromeSource).toContain('header: "Schedule / Trigger"');
    expect(detailChromeSource).toContain('header: "Status"');
    expect(detailChromeSource).toContain('header: "Last Run"');
    expect(detailChromeSource).toContain('header: "Next Run / Last Delivery"');
    expect(detailChromeSource).toContain(
      'to: "/automations/schedules/$scheduledJobId"',
    );
    expect(detailChromeSource).toContain(
      'to: "/automations/webhooks/$webhookId"',
    );
  });

  it("queries only the Space fields needed by the simplified UI", () => {
    const spacesListQuerySource = queriesSource.slice(
      queriesSource.indexOf("query SpacesList"),
      queriesSource.indexOf("export const CreateSpaceMutation"),
    );
    expect(queriesSource).toContain("query SpacesList");
    expect(queriesSource).toContain("mutation CreateSpace");
    expect(queriesSource).toContain("mutation UpdateSpace");
    expect(queriesSource).toContain("query SpaceAdminDetail");
    expect(queriesSource).toContain("mutation SetSpaceEmailTriggers");
    expect(queriesSource).toContain("query SpaceMemory");
    expect(queriesSource).toContain("mutation SetSpaceKnowledgeBases");
    expect(queriesSource).toContain("includeAllForAdmin: true");
    expect(queriesSource).toContain("accessMode");
    expect(queriesSource).toContain("emailTriggersEnabled");
    expect(queriesSource).toContain("setSpaceEmailTriggers");
    expect(queriesSource).toContain("knowledgeBases");
    expect(queriesSource).toContain("knowledgeBaseId");
    expect(queriesSource).toContain("setSpaceKnowledgeBases");
    expect(queriesSource).not.toContain("query SpaceTools");
    expect(queriesSource).not.toContain("mutation SetSpaceTools");
    expect(queriesSource).not.toContain("setSpaceTools(input");
    expect(queriesSource).not.toContain("mutation SetSpaceRuntimeOverrides");
    expect(queriesSource).not.toContain("setSpaceRuntimeOverrides");
    expect(queriesSource).not.toContain("runtimeOverrides");
    expect(spacesListQuerySource).not.toContain("agentAssignments");
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
  });

  it("registers the Members route and gates the tab to private Spaces", () => {
    const membersRouteSource = readSource("./$spaceId_.members.tsx");
    expect(routeTreeSource).toContain(
      "AuthedTenantSpacesSpaceIdMembersRouteImport",
    );
    expect(membersRouteSource).toContain(
      'createFileRoute(\n  "/_authed/_tenant/spaces/$spaceId_/members"',
    );
    expect(membersRouteSource).toContain("SpaceMembersPanel");
    expect(membersRouteSource).toContain('space.accessMode !== "PRIVATE"');
    expect(detailChromeSource).toContain('space.accessMode === "PRIVATE"');
    expect(detailChromeSource).toContain('value="members"');
    expect(detailChromeSource).toMatch(/>\s*Members\s*<\/Link>/);
    expect(queriesSource).toContain("SpaceMembers");
    expect(queriesSource).toContain("AddSpaceMember");
    expect(queriesSource).toContain("RemoveSpaceMember");
  });
});
