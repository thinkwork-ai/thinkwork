import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(
    process.cwd(),
    "src/components/settings/SettingsCogneeApplication.tsx",
  ),
  "utf8",
);
const routeSource = readFileSync(
  resolve(process.cwd(), "src/routes/_authed/settings.applications.cognee.tsx"),
  "utf8",
);

describe("SettingsCogneeApplication", () => {
  it("keeps the legacy config panel available for implementation reference", () => {
    expect(source).toContain("KnowledgeGraphConfigPanel");
    expect(source).toContain('label: "Applications"');
    expect(source).toContain('href: "/settings/managed-applications"');
    expect(source).toContain('label: "Cognee"');
  });

  it("redirects the legacy Cognee route to Company Brain plugin detail", () => {
    expect(routeSource).toContain("redirect({");
    expect(routeSource).toContain('to: "/settings/plugins/$pluginKey"');
    expect(routeSource).toContain('pluginKey: "company-brain"');
    expect(routeSource).not.toContain("ManagedApplicationRouteGuard");
    expect(routeSource).not.toContain("<SettingsCogneeApplication");
  });
});
