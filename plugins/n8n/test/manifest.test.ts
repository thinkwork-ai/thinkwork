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
  N8N_AGENT_STEP_BRIDGE_CREDENTIAL_KIND,
  N8N_AGENT_STEP_BRIDGE_CREDENTIAL_SECRET_JSON_KEY,
  N8N_AGENT_STEP_BRIDGE_ENDPOINT_PATH,
  N8N_MCP_ENDPOINT_PATH,
  N8N_WORKFLOW_OPERATOR_MCP_TOOLING_REFERENCE_MD,
  N8N_PLUGIN_LEGACY_VERSION,
  N8N_PLUGIN_VERSION,
  N8N_SERVICE_CREDENTIAL_KIND,
  N8N_SERVICE_CREDENTIAL_SECRET_JSON_KEY,
  N8N_WORKFLOW_OPERATOR_VALIDATION_AND_HANDOFF_REFERENCE_MD,
  N8N_WORKFLOW_OPERATOR_SKILL_MD,
  N8N_WORKFLOW_OPERATOR_SKILL_SLUG,
  N8N_WORKFLOW_OPERATOR_WORKFLOW_AUTHORING_REFERENCE_MD,
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
    expect(manifest.versions.map((entry) => entry.version)).toEqual([
      N8N_PLUGIN_LEGACY_VERSION,
      N8N_PLUGIN_VERSION,
    ]);
    expect(version.version).toBe(N8N_PLUGIN_LEGACY_VERSION);
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
      "agentStepBridgeCredentialSecretArn",
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
    expect(mcp.toolNotes?.join("\n")).toContain("separate inbound tenant");
    expect(mcp.toolNotes?.join("\n")).toContain("production activation");
    expect(N8N_AGENT_STEP_BRIDGE_ENDPOINT_PATH).toBe(
      "/api/integrations/n8n/agent-steps",
    );
    expect(N8N_AGENT_STEP_BRIDGE_CREDENTIAL_KIND).toBe(
      "n8n-agent-step-bridge-token",
    );
    expect(N8N_AGENT_STEP_BRIDGE_CREDENTIAL_SECRET_JSON_KEY).toBe(
      "THINKWORK_N8N_AGENT_STEP_BRIDGE_TOKEN",
    );
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
    expect(N8N_WORKFLOW_OPERATOR_SKILL_SLUG).toBe("n8n-workflow-operator");
    expect(N8N_WORKFLOW_OPERATOR_SKILL_SLUG).toMatch(
      /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,63}$/,
    );
    expect(skills.skills[0]?.supportingFiles?.map((file) => file.path)).toEqual(
      [
        "references/mcp-tooling.md",
        "references/workflow-authoring.md",
        "references/validation-and-handoff.md",
      ],
    );
    expect(N8N_WORKFLOW_OPERATOR_SKILL_MD).toContain(
      "name: n8n-workflow-operator",
    );
    expect(N8N_WORKFLOW_OPERATOR_SKILL_MD).toContain("license: Apache-2.0");
    expect(N8N_WORKFLOW_OPERATOR_SKILL_MD).toContain(
      "skill-format: agentskills",
    );
    expect(N8N_WORKFLOW_OPERATOR_SKILL_MD).toContain("MCP tooling");
    expect(N8N_WORKFLOW_OPERATOR_SKILL_MD).toContain(
      "references/mcp-tooling.md",
    );
    expect(N8N_WORKFLOW_OPERATOR_SKILL_MD).toContain(
      "references/workflow-authoring.md",
    );
    expect(N8N_WORKFLOW_OPERATOR_SKILL_MD).toContain(
      "references/validation-and-handoff.md",
    );
    expect(N8N_WORKFLOW_OPERATOR_SKILL_MD).toContain("HTTP Request");
    expect(N8N_WORKFLOW_OPERATOR_SKILL_MD).toContain("Wait nodes");
    expect(N8N_WORKFLOW_OPERATOR_SKILL_MD).toContain("$execution.resumeUrl");
    expect(N8N_WORKFLOW_OPERATOR_SKILL_MD).toContain(
      "custom ThinkWork n8n node",
    );
    expect(N8N_WORKFLOW_OPERATOR_MCP_TOOLING_REFERENCE_MD).toContain(
      "nodes-base.httpRequest",
    );
    expect(N8N_WORKFLOW_OPERATOR_MCP_TOOLING_REFERENCE_MD).toContain(
      "n8n-nodes-base.httpRequest",
    );
    expect(N8N_WORKFLOW_OPERATOR_MCP_TOOLING_REFERENCE_MD).toContain(
      "Shortened Tool Names",
    );
    expect(N8N_WORKFLOW_OPERATOR_WORKFLOW_AUTHORING_REFERENCE_MD).toContain(
      "Manual trigger",
    );
    expect(N8N_WORKFLOW_OPERATOR_WORKFLOW_AUTHORING_REFERENCE_MD).toContain(
      "$json.body",
    );
    expect(N8N_WORKFLOW_OPERATOR_VALIDATION_AND_HANDOFF_REFERENCE_MD).toContain(
      "Validation passing is necessary, not sufficient",
    );
    expect(N8N_WORKFLOW_OPERATOR_VALIDATION_AND_HANDOFF_REFERENCE_MD).toContain(
      "Handoff Checklist",
    );

    const skillRoot = new URL(
      "../src/skills/n8n-workflow-operator/",
      import.meta.url,
    );

    const skillFile = await readFile(
      fileURLToPath(new URL("SKILL.md", skillRoot)),
      "utf8",
    );
    expect(skillFile).toBe(N8N_WORKFLOW_OPERATOR_SKILL_MD);
    await expect(
      readFile(fileURLToPath(new URL("references/mcp-tooling.md", skillRoot)), {
        encoding: "utf8",
      }),
    ).resolves.toBe(N8N_WORKFLOW_OPERATOR_MCP_TOOLING_REFERENCE_MD);
    await expect(
      readFile(
        fileURLToPath(new URL("references/workflow-authoring.md", skillRoot)),
        { encoding: "utf8" },
      ),
    ).resolves.toBe(N8N_WORKFLOW_OPERATOR_WORKFLOW_AUTHORING_REFERENCE_MD);
    await expect(
      readFile(
        fileURLToPath(
          new URL("references/validation-and-handoff.md", skillRoot),
        ),
        { encoding: "utf8" },
      ),
    ).resolves.toBe(N8N_WORKFLOW_OPERATOR_VALIDATION_AND_HANDOFF_REFERENCE_MD);
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
