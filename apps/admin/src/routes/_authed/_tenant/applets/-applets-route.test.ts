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
    expect(detailRouteSource).toContain('TabsTrigger value="app"');
    expect(detailRouteSource).toContain('TabsTrigger value="source"');
    expect(detailRouteSource).toContain('TabsTrigger value="config"');
    expect(detailRouteSource).toContain("persistedSource");
    expect(detailRouteSource).toContain("formatJson(payload.metadata)");
    expect(detailRouteSource).not.toContain("saveApplet");
    expect(detailRouteSource).not.toContain("regenerateApplet");
  });
});
