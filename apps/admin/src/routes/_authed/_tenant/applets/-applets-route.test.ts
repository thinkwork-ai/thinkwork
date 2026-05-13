import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Apps admin routes", () => {
  const sidebarSource = readSource("../../../../components/Sidebar.tsx");
  const commandPaletteSource = readSource(
    "../../../../components/CommandPalette.tsx",
  );
  const queriesSource = readSource("../../../../lib/graphql-queries.ts");
  const listRouteSource = readSource("./index.tsx");
  const detailRouteSource = readSource("./$appId.tsx");

  it("exposes Artifacts as an admin surface", () => {
    expect(sidebarSource).toContain('label: "Artifacts"');
    expect(sidebarSource).toContain('to: "/applets"');
    expect(commandPaletteSource).toContain('label: "Artifacts"');
    expect(commandPaletteSource).toContain('to: "/applets"');
  });

  it("uses the admin-only applet queries", () => {
    expect(queriesSource).toContain("query AdminApplets");
    expect(queriesSource).toContain("adminApplets");
    expect(queriesSource).toContain("query AdminApplet");
    expect(queriesSource).toContain("adminApplet");
    expect(listRouteSource).toContain("AdminAppletsQuery");
    expect(detailRouteSource).toContain("AdminAppletQuery");
  });

  it("adds tenant app style controls without making applets editable", () => {
    expect(listRouteSource).toContain("Filter by user ID");
    expect(listRouteSource).toContain("Set App Style");
    expect(listRouteSource).toContain("UpdateTenantArtifactStyleMutation");
    expect(listRouteSource).toContain("artifactStyle");
    expect(listRouteSource).toContain('to: "/applets/$appId"');
    expect(detailRouteSource).toContain("AdminUpdateAppletSourceMutation");
    expect(detailRouteSource).toContain("CodeMirror");
    expect(detailRouteSource).toContain("AdminAppletPreview");
    expect(detailRouteSource).toContain("!overflow-hidden !pb-4");
    expect(detailRouteSource).toContain('activeTab === "app" || activeTab === "source"');
    expect(detailRouteSource).toContain("activeTab === \"source\"");
    expect(detailRouteSource).toContain('TabsContent value="source" className="min-h-0 overflow-hidden"');
    expect(detailRouteSource).toContain("h-full min-h-0 overflow-hidden rounded-md border bg-black");
    expect(detailRouteSource).toContain('variant="link"');
    expect(detailRouteSource).toContain("text-muted-foreground");
    expect(detailRouteSource).not.toContain("Save Source");
    expect(detailRouteSource).not.toContain("lineWrapping");
    expect(detailRouteSource).not.toContain("min-h-[520px]");
    expect(detailRouteSource).toContain('TabsTrigger value="app"');
    expect(detailRouteSource).toContain('TabsTrigger value="source"');
    expect(detailRouteSource).toContain('TabsTrigger value="config"');
    expect(detailRouteSource).not.toContain(">Source</div>");
    expect(detailRouteSource).not.toContain("src={appUrl}");
    expect(detailRouteSource).toContain("persistedSource");
    expect(detailRouteSource).toContain("formatJson(payload.metadata)");
    expect(detailRouteSource).not.toContain("saveApplet");
    expect(detailRouteSource).not.toContain("regenerateApplet");
  });
});
