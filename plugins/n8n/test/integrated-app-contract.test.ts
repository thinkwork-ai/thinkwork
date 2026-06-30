import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  validatePluginManifest,
  type UiSurfaceComponent,
} from "@thinkwork/plugin-catalog/contracts";
import { defineFirstPartyPluginPackage } from "@thinkwork/plugin-catalog/plugin-package";

import {
  N8N_APP_DESCRIPTION,
  N8N_APP_DISPLAY_NAME,
  N8N_APP_ICON,
  N8N_APP_KEY,
  N8N_APP_ROUTE_SEGMENT,
  N8N_APP_SURFACE_KEY,
  n8nApplicationConfig,
} from "../n8n-app/src/application-config";
import { n8nPluginPackage } from "../src/index";
import { N8N_PLUGIN_VERSION, n8nManifest } from "../src/manifest";

describe("n8n integrated app contract", () => {
  it("declares a launchable ThinkWork app surface in the n8n manifest", () => {
    const manifest = validatePluginManifest(n8nManifest);
    const latestVersion = manifest.versions.find(
      (version) => version.version === N8N_PLUGIN_VERSION,
    );
    if (!latestVersion) throw new Error("Missing latest n8n manifest version");

    const uiSurfaces = latestVersion.components.filter(
      (component): component is UiSurfaceComponent =>
        component.type === "ui-surface",
    );
    const appSurface = uiSurfaces.find(
      (component) => component.key === N8N_APP_SURFACE_KEY,
    );

    expect(appSurface).toEqual({
      type: "ui-surface",
      key: N8N_APP_SURFACE_KEY,
      displayName: N8N_APP_DISPLAY_NAME,
      intendedMount: "apps.main",
      launch: {
        schemaVersion: 1,
        type: "app",
        appKey: N8N_APP_KEY,
        routeSegment: N8N_APP_ROUTE_SEGMENT,
        mount: "main-shell",
        runtime: "trusted-bundled-react",
        description: N8N_APP_DESCRIPTION,
        icon: N8N_APP_ICON,
        entitlementProductKey: N8N_APP_KEY,
      },
    });
    expect(uiSurfaces).toContainEqual({
      type: "ui-surface",
      key: "package-settings",
      displayName: "n8n custom package settings",
      intendedMount: "settings.plugins.detail",
    });
  });

  it("keeps the original 0.1.0 manifest payload immutable for pinned installs", () => {
    const manifest = validatePluginManifest(n8nManifest);
    const legacyVersion = manifest.versions.find(
      (version) => version.version === "0.1.0",
    );
    if (!legacyVersion) throw new Error("Missing legacy n8n manifest version");

    expect(legacyVersion.components.map((component) => component.type)).toEqual([
      "infrastructure",
      "mcp-server",
      "ui-surface",
      "skills",
    ]);
    expect(
      legacyVersion.components.some(
        (component) =>
          component.type === "ui-surface" &&
          component.key === N8N_APP_SURFACE_KEY,
      ),
    ).toBe(false);
  });

  it("keeps the app source and auth decision inside the n8n package", () => {
    const defined = defineFirstPartyPluginPackage(n8nPluginPackage);

    expect(defined.ownedSources).toContainEqual({
      kind: "web",
      path: "plugins/n8n/n8n-app",
      description:
        "Native ThinkWork n8n installed app surface for workflow and execution operations.",
    });
    expect(n8nApplicationConfig).toMatchObject({
      schemaVersion: 1,
      appKey: "n8n-workflow-operations",
      host: {
        mount: "main-shell",
        runtime: "trusted-bundled-react",
        route: "/apps/n8n/workflows",
        sourceRoot: "plugins/n8n/n8n-app",
      },
      dataAccess: {
        mode: "thinkwork-session",
        boundary: "server-mediated",
      },
    });
    expect(n8nApplicationConfig.dataAccess.allowedCredentials).toEqual([
      "tenant-service-credential:n8n-mcp-access-token",
      "tenant-plugin-credential:n8n-api",
    ]);
    expect(n8nApplicationConfig.dataAccess.forbidden).toEqual([
      "browser-entered-api-key",
      "unauthenticated-proxy",
      "workflow-publish",
      "workflow-unpublish",
      "workflow-activate",
      "workflow-deactivate",
      "workflow-delete",
      "execution-retry",
      "execution-stop",
    ]);
  });

  it("documents the n8n host boundary before data APIs are added", async () => {
    const readme = await readFile(
      fileURLToPath(new URL("../n8n-app/README.md", import.meta.url)),
      "utf8",
    );
    const packageJson = await readFile(
      fileURLToPath(new URL("../n8n-app/package.json", import.meta.url)),
      "utf8",
    );

    expect(readme).toContain("/apps/n8n/workflows");
    expect(readme).toContain("does not use `twenty-sdk`");
    expect(readme).toContain("server-mediated");
    expect(readme).toContain("ThinkWork APIs");
    expect(readme).toContain("must not ask users to paste an n8n API key");
    expect(readme).toContain("activate");
    expect(readme).toContain("retry");
    expect(packageJson).toContain('"name": "@thinkwork/n8n-app"');
    expect(packageJson).toContain('"packageManager": "pnpm@9.15.9"');
  });
});
