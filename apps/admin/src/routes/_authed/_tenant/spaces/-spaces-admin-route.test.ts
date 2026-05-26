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
  const settingsRouteSource = readSource("./$spaceId_.settings.tsx");
  const workspaceRouteSource = readSource("./$spaceId_.workspace.tsx");
  const kbsRouteSource = readSource("./$spaceId_.kbs.tsx");
  const triggersRouteSource = readSource("./$spaceId_.triggers.tsx");
  const membersRouteSource = readSource("./$spaceId_.members.tsx");
  const membersPanelSource = readSource(
    "../../../../components/spaces/SpaceMembersPanel.tsx",
  );
  const queriesSource = readSource("../../../../lib/graphql-queries.ts");
  const routeTreeSource = readSource("../../../../routeTree.gen.ts");

  it("registers the renamed Space Studio routes", () => {
    expect(routeTreeSource).toContain("AuthedTenantSpacesIndexRouteImport");
    expect(routeTreeSource).toContain("AuthedTenantSpacesSpaceIdRouteImport");
    expect(routeTreeSource).toContain(
      "AuthedTenantSpacesSpaceIdWorkspaceRouteImport",
    );
    expect(routeTreeSource).toContain(
      "AuthedTenantSpacesSpaceIdKbsRouteImport",
    );
    expect(routeTreeSource).toContain(
      "AuthedTenantSpacesSpaceIdTriggersRouteImport",
    );
    expect(routeTreeSource).toContain(
      "AuthedTenantSpacesSpaceIdSettingsRouteImport",
    );
    expect(routeTreeSource).toContain(
      "AuthedTenantSpacesSpaceIdMembersRouteImport",
    );
    expect(routeTreeSource).not.toContain(
      "AuthedTenantSpacesSpaceIdConfigurationRouteImport",
    );
    expect(routeTreeSource).not.toContain(
      "AuthedTenantSpacesSpaceIdMemoryRouteImport",
    );
    expect(routeTreeSource).not.toContain(
      "AuthedTenantSpacesSpaceIdAutomationsRouteImport",
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
    expect(kbsRouteSource).toContain(
      '"/_authed/_tenant/spaces/$spaceId_/kbs"',
    );
    expect(triggersRouteSource).toContain(
      '"/_authed/_tenant/spaces/$spaceId_/triggers"',
    );
    expect(settingsRouteSource).toContain(
      '"/_authed/_tenant/spaces/$spaceId_/settings"',
    );
    expect(triggersRouteSource).toContain("SpaceTriggersPanel");
    expect(triggersRouteSource).toContain("SpaceTriggersAdd");
  });

  it("renders a Spaces table with a Description column and routes to Workspace", () => {
    expect(listRouteSource).toContain("SpacesListQuery");
    expect(listRouteSource).toContain("CreateSpaceMutation");
    expect(listRouteSource).toContain("New Space");
    expect(listRouteSource).toContain("<DataTable");
    expect(listRouteSource).toContain(
      ".sort((a, b) => a.name.localeCompare(b.name))",
    );
    expect(listRouteSource).toContain('header: "Space"');
    expect(listRouteSource).toContain('header: "Description"');
    expect(listRouteSource).toContain('header: "Access"');
    expect(listRouteSource).toContain('header: "Status"');
    expect(listRouteSource).toContain('header: "Updated"');
    expect(listRouteSource).toContain('to: "/spaces/$spaceId/workspace"');
    expect(listRouteSource).not.toContain('to: "/spaces/$spaceId/configuration"');
    expect(listRouteSource).not.toContain('header: "Kind"');
    expect(listRouteSource).not.toContain('header: "Agents"');
  });

  it("mounts Space Studio tabs in Workspace · KBs · Triggers · Settings · Members order", () => {
    const tabOrder = [
      'value="workspace"',
      'value="kbs"',
      'value="triggers"',
      'value="settings"',
      'value="members"',
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
    expect(detailChromeSource).toContain('to="/spaces/$spaceId/workspace"');
    expect(detailChromeSource).toContain('to="/spaces/$spaceId/kbs"');
    expect(detailChromeSource).toContain('to="/spaces/$spaceId/triggers"');
    expect(detailChromeSource).toContain('to="/spaces/$spaceId/settings"');
    expect(detailChromeSource).toContain('to="/spaces/$spaceId/members"');
    expect(detailChromeSource).toMatch(/>\s*Workspace\s*<\/Link>/);
    expect(detailChromeSource).toMatch(/>\s*KBs\s*<\/Link>/);
    expect(detailChromeSource).toMatch(/>\s*Triggers\s*<\/Link>/);
    expect(detailChromeSource).toMatch(/>\s*Settings\s*<\/Link>/);
    expect(detailRouteSource).toContain('to="/spaces/$spaceId/workspace"');
    expect(workspaceRouteSource).toContain("SpaceWorkspacePanel");
  });

  it("does not expose retired tab labels or panel exports", () => {
    expect(detailChromeSource).not.toContain('value="configuration"');
    expect(detailChromeSource).not.toContain('value="memory"');
    expect(detailChromeSource).not.toContain('value="automations"');
    expect(detailChromeSource).not.toContain("SpaceConfigurationPanel");
    expect(detailChromeSource).not.toContain("SpaceMemoryPanel");
    expect(detailChromeSource).not.toContain("SpaceAutomationsPanel");
    expect(detailChromeSource).not.toContain(
      'import { SpaceEmailTriggersToggle }',
    );
  });

  it("keeps Settings focused on editable user-facing fields and uses the Description label", () => {
    expect(detailChromeSource).toContain("SpaceSettingsPanel");
    expect(detailChromeSource).toContain("Name");
    expect(detailChromeSource).toContain(">Description<");
    expect(detailChromeSource).not.toContain(">Instructions<");
    expect(detailChromeSource).toContain("Access");
    expect(detailChromeSource).toContain("Save");
  });

  it("renders Triggers with a single Add dropdown and a Description column with copy affordances", () => {
    expect(detailChromeSource).toContain("SpaceTriggersPanel");
    expect(detailChromeSource).toContain("SpaceTriggersAdd");
    expect(detailChromeSource).toContain("CopyLinkButton");
    expect(detailChromeSource).toContain("/api/scheduled-jobs?");
    expect(detailChromeSource).toContain("/api/webhooks?");
    expect(detailChromeSource).toContain("ScheduledJobFormDialog");
    expect(detailChromeSource).toContain("WebhookFormDialog");
    expect(detailChromeSource).toContain('header: "Name"');
    expect(detailChromeSource).toContain('header: "Type"');
    expect(detailChromeSource).toContain('header: "Description"');
    expect(detailChromeSource).toContain('header: "Status"');
    expect(detailChromeSource).toContain('header: "Last Run"');
    expect(detailChromeSource).toContain('header: "Next Run / Last Delivery"');
    expect(detailChromeSource).not.toContain('header: "Schedule / Trigger"');
    expect(detailChromeSource).not.toContain("Add Schedule");
    expect(detailChromeSource).not.toContain("Add Webhook");
    expect(detailChromeSource).toContain("DropdownMenu");
    expect(detailChromeSource).toContain("emailTriggersEnabled");
    expect(detailChromeSource).toContain("deriveSpaceEmailAddress");
    expect(detailChromeSource).toContain("deriveWebhookUrl");
    expect(detailChromeSource).toContain("Disable email trigger?");
    expect(triggersRouteSource).toContain("headerActions");
  });

  it("synthesizes an email trigger row when emailTriggersEnabled is true", () => {
    expect(detailChromeSource).toContain('kind: "email"');
    expect(detailChromeSource).toContain('typeLabel: "Email"');
    expect(detailChromeSource).toContain("space.emailTriggersEnabled");
    expect(detailChromeSource).toContain("SetSpaceEmailTriggersMutation");
  });

  it("keeps KBs scoped to knowledge-base selection (panel renamed from Memory)", () => {
    expect(kbsRouteSource).toContain("SpaceKbsPanel");
    expect(detailChromeSource).toContain("MultiSelect");
    expect(detailChromeSource).toContain("KnowledgeBasesListQuery");
    expect(detailChromeSource).toContain("SpaceMemoryQuery");
    expect(detailChromeSource).toContain("SetSpaceKnowledgeBasesMutation");
    expect(detailChromeSource).toContain("Choose knowledge bases");
    expect(detailChromeSource).toContain("No knowledge bases selected.");
  });

  it("queries Space fields needed by the simplified UI", () => {
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
  });

  it("registers the Members route and gates the tab to private Spaces; redirects public Spaces to Workspace", () => {
    expect(membersRouteSource).toContain(
      'createFileRoute(\n  "/_authed/_tenant/spaces/$spaceId_/members"',
    );
    expect(membersRouteSource).toContain("SpaceMembersPanel");
    expect(membersRouteSource).toContain('accessMode === "PRIVATE"');
    expect(membersRouteSource).toContain('to: "/spaces/$spaceId/workspace"');
    expect(membersRouteSource).not.toContain(
      'to: "/spaces/$spaceId/configuration"',
    );
    expect(membersRouteSource).toContain("headerActions");
    expect(detailChromeSource).toContain('space.accessMode === "PRIVATE"');
    expect(detailChromeSource).toContain('value="members"');
    expect(detailChromeSource).toMatch(/>\s*Members\s*<\/Link>/);
    expect(queriesSource).toContain("SpaceMembers");
    expect(queriesSource).toContain("AddSpaceMember");
    expect(queriesSource).toContain("RemoveSpaceMember");
  });

  it("renders Members with separate User and Email columns and no in-panel subheader", () => {
    expect(membersPanelSource).toContain('header: "User"');
    expect(membersPanelSource).toContain('header: "Email"');
    expect(membersPanelSource).toContain('header: "Role"');
    expect(membersPanelSource).toContain('header: "Joined"');
    expect(membersPanelSource).not.toContain("People who can access this private Space.");
    expect(membersPanelSource).not.toContain("Add member");
    expect(membersPanelSource).toContain("addOpen");
    expect(membersPanelSource).toContain("onAddOpenChange");
  });
});
