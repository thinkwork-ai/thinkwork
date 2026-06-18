import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  validatePluginManifest,
  type PluginComponentType,
} from "@thinkwork/plugin-catalog/contracts";
import { defineFirstPartyPluginPackage } from "@thinkwork/plugin-catalog/plugin-package";

import { lakehousePluginPackage } from "../src";
import { LAKEHOUSE_SETTINGS_SURFACE, lakehouseManifest } from "../src/manifest";

describe("LakeHouse plugin manifest", () => {
  it("validates as an inert shell plugin", () => {
    const validated = validatePluginManifest(lakehouseManifest);

    expect(validated.pluginKey).toBe("lakehouse");
    expect(validated.displayName).toBe("LakeHouse");
    expect(validated.versions[0].version).toBe("0.1.0");
    expect(validated.versions[0].requiredOauthScopes).toEqual([]);
    expect(validated.versions[0].capabilities).toEqual([]);
    expect(validated.versions[0].components).toEqual([
      {
        type: "ui-surface",
        key: "settings",
        displayName: "LakeHouse settings",
        intendedMount: LAKEHOUSE_SETTINGS_SURFACE,
      },
    ]);
  });

  it("does not declare side-effecting components, OAuth scopes, or secrets", () => {
    const version = lakehouseManifest.versions[0];
    const componentTypes = version.components.map(
      (component) => component.type as PluginComponentType,
    );
    const serializedManifest = JSON.stringify(lakehouseManifest);

    expect(componentTypes).toEqual(["ui-surface"]);
    expect(componentTypes).not.toContain("infrastructure");
    expect(componentTypes).not.toContain("mcp-server");
    expect(componentTypes).not.toContain("skills");
    expect(version.requiredOauthScopes).toEqual([]);
    expect(serializedManifest).not.toMatch(
      /https?:\/\/|\.invalid|terraform|managedAppKey|endpointUrl|endpointFrom|credential|secret|skillMd/i,
    );
  });

  it("keeps customer-facing copy on the shell boundary", () => {
    const customerFacingText = [
      lakehouseManifest.displayName,
      lakehouseManifest.description,
      ...lakehouseManifest.versions[0].components.map(
        (component) => component.displayName,
      ),
    ].join("\n");

    expect(customerFacingText).toContain("LakeHouse");
    expect(customerFacingText).toContain("solution shell");
    expect(customerFacingText).toContain("deferred");
    expect(customerFacingText).not.toMatch(
      /\b(deploys?|queries|monitors?|automates?|provisions?|connects? to|operates?)\b/i,
    );
  });

  it("defines a first-party package boundary under plugins/lakehouse", () => {
    const defined = defineFirstPartyPluginPackage(lakehousePluginPackage);

    expect(defined.packageKey).toBe("lakehouse");
    expect(defined.sourceRoot).toBe("plugins/lakehouse");
    expect(defined.ownedSources).toContainEqual({
      kind: "manifest",
      path: "plugins/lakehouse/src/manifest.ts",
      description:
        "LakeHouse catalog manifest for the shell-only plugin identity.",
    });
    expect(defined.ownedSources).toContainEqual({
      kind: "tests",
      path: "plugins/lakehouse/test",
      description: "LakeHouse package-local manifest and shell-boundary tests.",
    });
    expect(defined.compatibilityLinks).toEqual([]);
  });

  it("documents deferred resource deployment for future implementers", () => {
    const readmePath = fileURLToPath(new URL("../README.md", import.meta.url));
    const readme = readFileSync(readmePath, "utf8");

    expect(readme).toContain("intentionally does not deploy");
    expect(readme).toContain("datalake");
    expect(readme).toContain("warehouse");
    expect(readme).toContain("MCP");
    expect(readme).toContain("Terraform-managed resources");
  });
});
