import { describe, expect, it } from "vitest";
import { managedAppRegistry } from "@thinkwork/deployment-runner/apps/registry";

import {
  validatePluginManifest,
  type InfrastructureComponent,
  type McpServerComponent,
  type SkillsComponent,
} from "@thinkwork/plugin-catalog/contracts";

import { planeManifest } from "../src/manifest";

const validatedPlaneManifest = validatePluginManifest(planeManifest);

function infrastructureComponent(): InfrastructureComponent {
  const component = validatedPlaneManifest.versions[0].components.find(
    (candidate) => candidate.type === "infrastructure",
  );
  if (component?.type !== "infrastructure") {
    throw new Error("plane manifest is missing its infrastructure component");
  }
  return component;
}

function skillsComponent(): SkillsComponent {
  const component = validatedPlaneManifest.versions[0].components.find(
    (candidate) => candidate.type === "skills",
  );
  if (component?.type !== "skills") {
    throw new Error("plane manifest is missing its skills component");
  }
  return component;
}

function mcpComponent(): McpServerComponent {
  const component = validatedPlaneManifest.versions[0].components.find(
    (candidate) => candidate.type === "mcp-server",
  );
  if (component?.type !== "mcp-server") {
    throw new Error("plane manifest is missing its mcp-server component");
  }
  return component;
}

function adapterRequiredInputs(operation: "ENABLE" | "UPGRADE"): string[] {
  const adapter = managedAppRegistry.find(
    (candidate) => candidate.appKey === "plane",
  );
  if (!adapter) {
    throw new Error("Plane managed-app adapter is not registered");
  }
  return adapter
    .requiredInputs(operation)
    .map((input) => input.key)
    .sort();
}

describe("Plane plugin manifest", () => {
  it("validates as a published Plane plugin", () => {
    const validated = validatePluginManifest(planeManifest);
    expect(validated.pluginKey).toBe("plane");
    expect(validated.versions[0].version).toBe("0.1.0");
    expect(
      validated.versions[0].components.map((component) => component.type),
    ).toEqual(["mcp-server", "infrastructure", "skills"]);
  });

  it("declares a user-scoped Plane MCP endpoint with PAT headers", () => {
    const mcp = mcpComponent();
    expect(mcp).toMatchObject({
      type: "mcp-server",
      key: "issues",
      displayName: "Plane work items",
      endpointFrom: {
        managedApp: "plane",
        configKey: "publicUrl",
        path: "/http/api-key/mcp",
      },
      auth: {
        mode: "user-provided-headers",
        headers: [
          {
            name: "x-api-key",
            credentialKey: "apiKey",
            displayName: "Plane personal access token",
            secret: true,
          },
          {
            name: "x-workspace-slug",
            credentialKey: "workspaceSlug",
            displayName: "Plane workspace slug",
          },
        ],
      },
    });
  });

  it("declares the Plane runtime infrastructure contract", () => {
    const infra = infrastructureComponent();
    expect(infra).toMatchObject({
      type: "infrastructure",
      key: "runtime",
      managedAppKey: "plane",
    });
    expect(Object.keys(infra.terraformInputs).sort()).toEqual([
      "adminImageUri",
      "aesSecretKeySecretArn",
      "amqpUrlSecretArn",
      "backendImageUri",
      "certificateArn",
      "dbUrlSecretArn",
      "frontendImageUri",
      "liveImageUri",
      "liveServerSecretKeySecretArn",
      "mcpImageUri",
      "publicUrl",
      "s3AccessKeyIdSecretArn",
      "s3BucketName",
      "s3SecretAccessKeySecretArn",
      "secretKeySecretArn",
      "spaceImageUri",
    ]);
    for (const spec of Object.values(infra.terraformInputs)) {
      expect(spec.description.length).toBeGreaterThan(0);
      expect(spec.type).toBe("string");
    }
  });

  it("keeps infrastructure inputs aligned with the managed-app adapter", () => {
    const inputs = Object.keys(
      infrastructureComponent().terraformInputs,
    ).sort();
    expect(inputs).toEqual(adapterRequiredInputs("ENABLE"));
    expect(inputs).toEqual(adapterRequiredInputs("UPGRADE"));
  });

  it("bundles the Plane issue-loop skill", () => {
    const skills = skillsComponent();
    expect(skills.skills).toHaveLength(1);
    const skill = skills.skills[0];
    expect(skill.slug).toBe("plane--issue-loop");
    expect(skill.skillMd).toContain("Activation and scope");
    expect(skill.skillMd).toContain("Resolve the workspace slug and project");
    expect(skill.skillMd).toContain("ENG-42");
    expect(skill.skillMd).toContain("Plane UUID");
    expect(skill.skillMd).toContain("project key");
    expect(skill.skillMd).toContain("Never use a tenant-wide Plane API key");
    expect(skill.skillMd).toContain("Prefer comments for progress");
    expect(skill.skillMd).toContain("Write-back discipline");
    expect(skill.skillMd).toContain("re-read the Plane record");
    expect(skill.skillMd).toContain("Stop conditions");
    expect(skill.skillMd).toContain("creating a duplicate");
  });

  it("uses header activation rather than OAuth scopes", () => {
    expect(mcpComponent().auth.mode).toBe("user-provided-headers");
    expect(validatedPlaneManifest.versions[0].requiredOauthScopes).toEqual([]);
  });
});
