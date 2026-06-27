import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  validatePluginManifest,
  type PluginComponentType,
} from "@thinkwork/plugin-catalog/contracts";
import { defineFirstPartyPluginPackage } from "@thinkwork/plugin-catalog/plugin-package";

import { companyEtlPluginPackage } from "../src";
import {
  COMPANY_ETL_SETTINGS_SURFACE,
  companyEtlManifest,
} from "../src/manifest";

describe("ThinkWork ETL plugin manifest", () => {
  it("validates as an inert shell plugin", () => {
    const validated = validatePluginManifest(companyEtlManifest);

    expect(validated.pluginKey).toBe("company-etl");
    expect(validated.displayName).toBe("ThinkWork ETL");
    expect(validated.versions[0].version).toBe("0.1.0");
    expect(validated.versions[0].requiredOauthScopes).toEqual([]);
    expect(validated.versions[0].capabilities).toEqual([]);
    expect(validated.versions[0].components).toEqual([
      {
        type: "ui-surface",
        key: "settings",
        displayName: "ThinkWork ETL settings",
        intendedMount: COMPANY_ETL_SETTINGS_SURFACE,
      },
    ]);
  });

  it("does not declare side-effecting components, OAuth scopes, or secrets", () => {
    const version = companyEtlManifest.versions[0];
    const componentTypes = version.components.map(
      (component) => component.type as PluginComponentType,
    );
    const serializedManifest = JSON.stringify(companyEtlManifest);

    expect(componentTypes).toEqual(["ui-surface"]);
    expect(componentTypes).not.toContain("infrastructure");
    expect(componentTypes).not.toContain("mcp-server");
    expect(componentTypes).not.toContain("skills");
    expect(version.requiredOauthScopes).toEqual([]);
    expect(serializedManifest).not.toMatch(
      /https?:\/\/|\.invalid|terraform|managedAppKey|endpointUrl|endpointFrom|credential|secret|skillMd/i,
    );
  });

  it("keeps customer-facing copy on the ETL integration scope", () => {
    const customerFacingText = [
      companyEtlManifest.displayName,
      companyEtlManifest.description,
      ...companyEtlManifest.versions[0].components.map(
        (component) => component.displayName,
      ),
    ].join("\n");

    expect(customerFacingText).toContain("ThinkWork ETL");
    expect(customerFacingText).toContain("tenant-managed ETL shell");
    expect(customerFacingText).toContain("SaaS apps");
    expect(customerFacingText).toContain("agent-accessible systems");
    expect(customerFacingText).toContain("ThinkWork Data Warehouse projection");
    expect(customerFacingText).toContain("separate plugins");
    expect(customerFacingText).not.toContain("Company ETL");
    expect(customerFacingText).not.toContain("Company Data");
    expect(customerFacingText).not.toMatch(
      /\b(deploys?|provides?|operates?)\s+(analytics|BI|dashboards?|lakehouse query)/i,
    );
  });

  it("defines a first-party package boundary under plugins/company-etl", () => {
    const defined = defineFirstPartyPluginPackage(companyEtlPluginPackage);

    expect(defined.packageKey).toBe("company-etl");
    expect(defined.sourceRoot).toBe("plugins/company-etl");
    expect(defined.ownedSources).toContainEqual({
      kind: "manifest",
      path: "plugins/company-etl/src/manifest.ts",
      description:
        "Company ETL catalog manifest for the shell-only plugin identity.",
    });
    expect(defined.ownedSources).toContainEqual({
      kind: "tests",
      path: "plugins/company-etl/test",
      description:
        "Company ETL package-local manifest and shell-boundary tests.",
    });
    expect(defined.compatibilityLinks).toEqual([]);
  });

  it("documents deferred resource deployment for future implementers", () => {
    const readmePath = fileURLToPath(new URL("../README.md", import.meta.url));
    const readme = readFileSync(readmePath, "utf8");

    expect(readme).toContain("intentionally does not deploy");
    expect(readme).toContain("connector runtime");
    expect(readme).toContain("ETL jobs");
    expect(readme).toContain("analytics UI");
    expect(readme).toContain("BI");
    expect(readme).toContain("warehouse");
    expect(readme).toContain("MCP");
    expect(readme).toContain("Terraform-managed resources");
  });
});
