import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const legacyApplicationRoute = readFileSync(
  resolve(process.cwd(), "src/routes/_authed/settings.applications.cognee.tsx"),
  "utf8",
);
const legacyDataIntegrationsPluginRoute = readFileSync(
  resolve(
    process.cwd(),
    "src/routes/_authed/settings.plugins.data-integrations.tsx",
  ),
  "utf8",
);

describe("legacy plugin redirects", () => {
  it("redirects the legacy application route to Company Brain plugin detail", () => {
    expect(legacyApplicationRoute).toContain("redirect({");
    expect(legacyApplicationRoute).toContain(
      'to: "/settings/plugins/$pluginKey"',
    );
    expect(legacyApplicationRoute).toContain('pluginKey: "company-brain"');
    expect(legacyApplicationRoute).not.toContain(
      "ManagedApplicationRouteGuard",
    );
  });

  it("redirects the legacy Data Integrations plugin route to Company ETL", () => {
    expect(legacyDataIntegrationsPluginRoute).toContain("redirect({");
    expect(legacyDataIntegrationsPluginRoute).toContain(
      'to: "/settings/plugins/$pluginKey"',
    );
    expect(legacyDataIntegrationsPluginRoute).toContain(
      'pluginKey: "company-etl"',
    );
  });
});
