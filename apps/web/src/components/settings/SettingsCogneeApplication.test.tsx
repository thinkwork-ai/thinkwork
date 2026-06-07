import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/components/settings/SettingsCogneeApplication.tsx"),
  "utf8",
);
const routeSource = readFileSync(
  resolve(process.cwd(), "src/routes/_authed/settings.applications.cognee.tsx"),
  "utf8",
);

describe("SettingsCogneeApplication", () => {
  it("renders the Cognee config panel under an Applications > Cognee breadcrumb", () => {
    expect(source).toContain("KnowledgeGraphConfigPanel");
    expect(source).toContain('label: "Applications"');
    expect(source).toContain('href: "/settings/managed-applications"');
    expect(source).toContain('label: "Cognee"');
  });

  it("guards the Cognee application route on the cognee managed app", () => {
    expect(routeSource).toContain("ManagedApplicationRouteGuard");
    expect(routeSource).toContain('appKey="cognee"');
    expect(routeSource).toContain("<SettingsCogneeApplication");
  });
});
