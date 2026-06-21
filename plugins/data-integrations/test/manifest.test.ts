import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  validatePluginManifest,
  type PluginComponentType,
} from "@thinkwork/plugin-catalog/contracts";
import { defineFirstPartyPluginPackage } from "@thinkwork/plugin-catalog/plugin-package";

import { dataIntegrationsPluginPackage } from "../src";
import {
  DATA_INTEGRATIONS_SETTINGS_SURFACE,
  dataIntegrationsManifest,
} from "../src/manifest";

describe("Data Integrations plugin manifest", () => {
  it("validates as an inert shell plugin", () => {
    const validated = validatePluginManifest(dataIntegrationsManifest);

    expect(validated.pluginKey).toBe("data-integrations");
    expect(validated.displayName).toBe("Data Integrations");
    expect(validated.versions[0].version).toBe("0.1.0");
    expect(validated.versions[0].requiredOauthScopes).toEqual([]);
    expect(validated.versions[0].capabilities).toEqual([]);
    expect(validated.versions[0].components).toEqual([
      {
        type: "ui-surface",
        key: "settings",
        displayName: "Data Integrations settings",
        intendedMount: DATA_INTEGRATIONS_SETTINGS_SURFACE,
      },
    ]);
  });

  it("does not declare side-effecting components, OAuth scopes, or secrets", () => {
    const version = dataIntegrationsManifest.versions[0];
    const componentTypes = version.components.map(
      (component) => component.type as PluginComponentType,
    );
    const serializedManifest = JSON.stringify(dataIntegrationsManifest);

    expect(componentTypes).toEqual(["ui-surface"]);
    expect(componentTypes).not.toContain("infrastructure");
    expect(componentTypes).not.toContain("mcp-server");
    expect(componentTypes).not.toContain("skills");
    expect(version.requiredOauthScopes).toEqual([]);
    expect(serializedManifest).not.toMatch(
      /https?:\/\/|\.invalid|terraform|managedAppKey|endpointUrl|endpointFrom|credential|secret|skillMd/i,
    );
  });

  it("keeps customer-facing copy on the ELT integration scope", () => {
    const customerFacingText = [
      dataIntegrationsManifest.displayName,
      dataIntegrationsManifest.description,
      ...dataIntegrationsManifest.versions[0].components.map(
        (component) => component.displayName,
      ),
    ].join("\n");

    expect(customerFacingText).toContain("Data Integrations");
    expect(customerFacingText).toContain("tenant-managed ELT integration");
    expect(customerFacingText).toContain("SaaS apps");
    expect(customerFacingText).toContain("agent-accessible systems");
    expect(customerFacingText).toContain("separate plugins");
    expect(customerFacingText).not.toMatch(
      /\b(deploys?|provides?|operates?)\s+(analytics|BI|dashboards?|lakehouse query)/i,
    );
  });

  it("defines a first-party package boundary under plugins/data-integrations", () => {
    const defined = defineFirstPartyPluginPackage(
      dataIntegrationsPluginPackage,
    );

    expect(defined.packageKey).toBe("data-integrations");
    expect(defined.sourceRoot).toBe("plugins/data-integrations");
    expect(defined.ownedSources).toContainEqual({
      kind: "manifest",
      path: "plugins/data-integrations/src/manifest.ts",
      description:
        "Data Integrations catalog manifest for the shell-only plugin identity.",
    });
    expect(defined.ownedSources).toContainEqual({
      kind: "tests",
      path: "plugins/data-integrations/test",
      description:
        "Data Integrations package-local manifest and shell-boundary tests.",
    });
    expect(defined.compatibilityLinks).toEqual([]);
  });

  it("documents deferred resource deployment for future implementers", () => {
    const readmePath = fileURLToPath(new URL("../README.md", import.meta.url));
    const readme = readFileSync(readmePath, "utf8");

    expect(readme).toContain("intentionally does not deploy");
    expect(readme).toContain("connector runtime");
    expect(readme).toContain("ELT jobs");
    expect(readme).toContain("analytics UI");
    expect(readme).toContain("BI");
    expect(readme).toContain("warehouse");
    expect(readme).toContain("MCP");
    expect(readme).toContain("Terraform-managed resources");
  });
});
