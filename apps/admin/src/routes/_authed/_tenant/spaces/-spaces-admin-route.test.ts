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
    expect(listRouteSource).toContain("<DataTable");
    expect(listRouteSource).toContain('header: "Space"');
    expect(listRouteSource).toContain('header: "Agents"');
    expect(listRouteSource).toContain('header: "Checklist"');
    expect(listRouteSource).toContain('to: "/spaces/$spaceId"');
  });

  it("keeps Threads as work records inside Space detail", () => {
    expect(detailRouteSource).toContain('value="threads"');
    expect(detailRouteSource).toContain("ThreadsPagedQuery");
    expect(detailRouteSource).toContain("spaceId");
    expect(detailRouteSource).toContain("ThreadsTable");
    expect(detailRouteSource).toContain('to: "/threads/$threadId"');
  });

  it("shows the Space configuration surfaces", () => {
    expect(detailRouteSource).toContain('value="agents"');
    expect(detailRouteSource).toContain('value="checklist"');
    expect(detailRouteSource).toContain('value="members"');
    expect(detailRouteSource).toContain('value="integrations"');
    expect(detailRouteSource).toContain('value="settings"');
    expect(detailRouteSource).toContain("Space Prompt");
    expect(detailRouteSource).toContain("Configured Agents");
    expect(detailRouteSource).toContain("Required Checklist Items");
  });

  it("queries Space configuration needed by the admin module", () => {
    expect(queriesSource).toContain("query SpacesList");
    expect(queriesSource).toContain("query SpaceAdminDetail");
    expect(queriesSource).toContain("agentAssignments");
    expect(queriesSource).toContain("localInstructions");
    expect(queriesSource).toContain("checklistTemplates");
    expect(queriesSource).toContain("integrations");
    expect(queriesSource).toContain("members");
  });
});
