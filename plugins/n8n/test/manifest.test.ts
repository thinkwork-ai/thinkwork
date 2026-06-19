import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { defineFirstPartyPluginPackage } from "@thinkwork/plugin-catalog/plugin-package";
import {
  validatePluginManifest,
  type PluginComponent,
} from "@thinkwork/plugin-catalog/contracts";

import {
  N8N_MCP_ENDPOINT_PATH,
  N8N_PLUGIN_VERSION,
  N8N_SERVICE_CREDENTIAL_KIND,
  N8N_SERVICE_CREDENTIAL_SECRET_JSON_KEY,
  N8N_WORKFLOW_OPERATOR_SKILL_MD,
  N8N_WORKFLOW_OPERATOR_SKILL_SLUG,
  n8nManifest,
} from "../src/manifest";
import { n8nPluginPackage } from "../src/index";

describe("n8n plugin manifest", () => {
  it("publishes a valid first-party package descriptor", () => {
    const validatedPackage = defineFirstPartyPluginPackage(n8nPluginPackage);

    expect(validatedPackage).toMatchObject({
      packageKey: "n8n",
      sourceRoot: "plugins/n8n",
      manifest: n8nManifest,
      compatibilityLinks: [],
    });
    expect("draftManifest" in n8nPluginPackage).toBe(false);
    expect("publicationStatus" in n8nPluginPackage).toBe(false);
    expect(validatedPackage.ownedSources.map((source) => source.kind)).toEqual([
      "manifest",
      "deployment",
      "terraform",
      "runtime",
      "web",
      "skills",
      "smoke",
      "tests",
      "docs",
    ]);
  });

  it("declares the final runtime, MCP, settings, and skill components", () => {
    const manifest = validatePluginManifest(n8nManifest);
    const version = manifest.versions[0]!;

    expect(manifest).toMatchObject({
      pluginKey: "n8n",
      displayName: "n8n",
      description: expect.stringContaining("workflow automation runtime"),
    });
    expect(version.version).toBe(N8N_PLUGIN_VERSION);
    expect(version.requiredOauthScopes).toEqual([]);
    expect(version.components.map((component) => component.type)).toEqual([
      "infrastructure",
      "mcp-server",
      "ui-surface",
      "skills",
    ]);
  });

  it("maps infrastructure inputs onto the n8n managed-app adapter contract", () => {
    const infra = component("infrastructure");

    expect(infra).toMatchObject({
      key: "runtime",
      managedAppKey: "n8n",
    });
    expect(Object.keys(infra.terraformInputs)).toEqual([
      "imageUri",
      "databaseAdminSecretArn",
      "databaseUrlSecretArn",
      "encryptionKeySecretArn",
      "operatorSecretArn",
      "serviceCredentialSecretArn",
      "storageBucketName",
      "publicUrl",
      "certificateArn",
    ]);
  });

  it("uses tenant service credential auth for the native n8n MCP endpoint", () => {
    const mcp = component("mcp-server");

    expect(mcp).toMatchObject({
      key: "workflow-management",
      displayName: "n8n workflow management",
      endpointFrom: {
        managedApp: "n8n",
        configKey: "publicUrl",
        path: N8N_MCP_ENDPOINT_PATH,
      },
      auth: {
        mode: "tenant-service-credential",
        credentialKind: N8N_SERVICE_CREDENTIAL_KIND,
        secretRefConfigKey: "serviceCredentialSecretArn",
        headers: [
          {
            name: "Authorization",
            secretJsonKey: N8N_SERVICE_CREDENTIAL_SECRET_JSON_KEY,
            valuePrefix: "Bearer ",
          },
        ],
      },
    });
    expect(mcp.toolNotes?.join("\n")).toContain("enable instance-level MCP");
    expect(mcp.toolNotes?.join("\n")).toContain("production activation");
  });

  it("declares Plugin Detail custom package settings and operator instructions", async () => {
    const ui = component("ui-surface");
    const skills = component("skills");

    expect(ui).toMatchObject({
      key: "package-settings",
      displayName: "n8n custom package settings",
      intendedMount: "settings.plugins.detail",
    });
    expect(skills.skills).toHaveLength(1);
    expect(skills.skills[0]).toMatchObject({
      slug: N8N_WORKFLOW_OPERATOR_SKILL_SLUG,
      skillMd: N8N_WORKFLOW_OPERATOR_SKILL_MD,
    });
    expect(N8N_WORKFLOW_OPERATOR_SKILL_MD).toContain("publish, unpublish");
    expect(N8N_WORKFLOW_OPERATOR_SKILL_MD).toContain("workflow id");
    expect(N8N_WORKFLOW_OPERATOR_SKILL_MD).toContain(
      "shared native n8n operator",
    );
    expect(N8N_WORKFLOW_OPERATOR_SKILL_MD).toMatch(
      /Plugin Detail n8n custom\s+package settings/,
    );

    const skillFile = await readFile(
      fileURLToPath(
        new URL(
          "../src/skills/n8n-workflow-operator/SKILL.md",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    expect(skillFile).toContain("publish, unpublish");
    expect(skillFile).toContain("workflow id");
    expect(skillFile).toContain("shared native n8n operator");
  });

  it("keeps LastMile runtime source out of the n8n package", async () => {
    const packageRoot = fileURLToPath(new URL("..", import.meta.url));
    const packagePaths = await listPackagePaths(packageRoot);

    expect(
      packagePaths.filter((path) =>
        /lastmile|custom-node|credential/i.test(path),
      ),
    ).toEqual([]);
  });
});

function component<TType extends PluginComponent["type"]>(
  type: TType,
): Extract<PluginComponent, { type: TType }> {
  const found = n8nManifest.versions[0]!.components.find(
    (entry) => entry.type === type,
  );
  if (!found) throw new Error(`Missing n8n manifest component ${type}`);
  return found as Extract<PluginComponent, { type: TType }>;
}

async function listPackagePaths(root: string): Promise<string[]> {
  const paths: string[] = [];
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const absolutePath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (entry.isFile()) {
        paths.push(absolutePath.slice(root.length + 1).replaceAll("\\", "/"));
      }
    }
  }
  await walk(root);
  return paths.sort();
}
