import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  validatePluginManifest,
  type PluginComponentType,
} from "@thinkwork/plugin-catalog/contracts";
import { defineFirstPartyPluginPackage } from "@thinkwork/plugin-catalog/plugin-package";

import { companyDataPluginPackage } from "../src";
import {
  COMPANY_DATA_SETTINGS_SURFACE,
  companyDataManifest,
} from "../src/manifest";

describe("Company Data plugin manifest", () => {
  it("validates as an inert shell plugin", () => {
    const validated = validatePluginManifest(companyDataManifest);

    expect(validated.pluginKey).toBe("company-data");
    expect(validated.displayName).toBe("Company Data");
    expect(validated.versions[0].version).toBe("0.1.0");
    expect(validated.versions[0].requiredOauthScopes).toEqual([]);
    expect(validated.versions[0].capabilities).toEqual([]);
    expect(validated.versions[0].components).toEqual([
      {
        type: "ui-surface",
        key: "settings",
        displayName: "Company Data settings",
        intendedMount: COMPANY_DATA_SETTINGS_SURFACE,
      },
    ]);
  });

  it("does not declare side-effecting components, OAuth scopes, or secrets", () => {
    const version = companyDataManifest.versions[0];
    const componentTypes = version.components.map(
      (component) => component.type as PluginComponentType,
    );
    const serializedManifest = JSON.stringify(companyDataManifest);

    expect(componentTypes).toEqual(["ui-surface"]);
    expect(componentTypes).not.toContain("infrastructure");
    expect(componentTypes).not.toContain("mcp-server");
    expect(componentTypes).not.toContain("skills");
    expect(version.requiredOauthScopes).toEqual([]);
    expect(serializedManifest).not.toMatch(
      /https?:\/\/|\.invalid|terraform|managedAppKey|endpointUrl|endpointFrom|credential|secret|skillMd/i,
    );
  });

  it("keeps customer-facing copy on the governed operational facts scope", () => {
    const customerFacingText = [
      companyDataManifest.displayName,
      companyDataManifest.description,
      ...companyDataManifest.versions[0].components.map(
        (component) => component.displayName,
      ),
    ].join("\n");

    expect(customerFacingText).toContain("Company Data");
    expect(customerFacingText).toContain("governed operational facts");
    expect(customerFacingText).toContain("agent and UI reads");
    expect(customerFacingText).toContain("later Company Data releases");
    expect(customerFacingText).not.toMatch(
      /\b(stores?|loads?)\s+every\s+operational\s+row\s+in\s+Company\s+Brain/i,
    );
    expect(customerFacingText).not.toMatch(
      /\b(deploys?|provides?|operates?)\s+(analytics|BI|dashboards?|lakehouse query|ELT jobs?|extraction runners?|projection databases?)/i,
    );
    expect(customerFacingText).not.toMatch(
      /\b(replaces?|mutates?|writes? back to)\s+source systems?/i,
    );
  });

  it("defines a first-party package boundary under plugins/company-data", () => {
    const defined = defineFirstPartyPluginPackage(companyDataPluginPackage);

    expect(defined.packageKey).toBe("company-data");
    expect(defined.sourceRoot).toBe("plugins/company-data");
    expect(defined.ownedSources).toContainEqual({
      kind: "manifest",
      path: "plugins/company-data/src/manifest.ts",
      description:
        "Company Data catalog manifest for the shell-only plugin identity.",
    });
    expect(defined.ownedSources).toContainEqual({
      kind: "tests",
      path: "plugins/company-data/test",
      description:
        "Company Data package-local manifest and shell-boundary tests.",
    });
    expect(defined.compatibilityLinks).toEqual([]);
  });

  it("documents deferred resource deployment for future implementers", () => {
    const readmePath = fileURLToPath(new URL("../README.md", import.meta.url));
    const readme = readFileSync(readmePath, "utf8");

    expect(readme).toContain("intentionally does not deploy");
    expect(readme).toContain("extraction runners");
    expect(readme).toContain("projection database");
    expect(readme).toContain("mapping workflows");
    expect(readme).toContain("MCP");
    expect(readme).toContain("Context Engine providers");
    expect(readme).toContain("credentials");
    expect(readme).toContain("analytics UI");
    expect(readme).toContain("BI");
    expect(readme).toContain("source-system writes");
    expect(readme).toContain("Terraform-managed resources");
  });
});
