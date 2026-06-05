import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/components/settings/SettingsCrm.tsx"),
  "utf8",
);
const routeSource = readFileSync(
  resolve(process.cwd(), "src/routes/_authed/settings.crm.tsx"),
  "utf8",
);

describe("SettingsCrm", () => {
  it("renders Twenty CRM operational details without SSO controls", () => {
    expect(source).toContain("Twenty CRM deployment");
    expect(source).toContain("First admin setup");
    expect(source).toContain("Twenty native first-user setup");
    expect(source).toContain("Follow-up: connect ThinkWork/Cognito SSO");
    expect(source).toContain("SettingsManagedApplicationHealthCheckQuery");
    expect(source).toContain("managedApplicationHealthCheck");
  });

  it("guards direct CRM route access by managed app runtime status", () => {
    expect(routeSource).toContain("ManagedApplicationRouteGuard");
    expect(routeSource).toContain('appKey="twenty"');
  });
});
