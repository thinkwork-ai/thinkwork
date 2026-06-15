import { describe, expect, it } from "vitest";

import {
  validatePluginManifest,
  type InfrastructureComponent,
  type McpServerComponent,
  type SkillsComponent,
} from "../contracts";
import { allPluginManifests, planeManifest } from "../plugins";

function infrastructureComponent(): InfrastructureComponent {
  const component = planeManifest.versions[0].components.find(
    (candidate) => candidate.type === "infrastructure",
  );
  if (component?.type !== "infrastructure") {
    throw new Error("plane manifest is missing its infrastructure component");
  }
  return component;
}

function skillsComponent(): SkillsComponent {
  const component = planeManifest.versions[0].components.find(
    (candidate) => candidate.type === "skills",
  );
  if (component?.type !== "skills") {
    throw new Error("plane manifest is missing its skills component");
  }
  return component;
}

function mcpComponent(): McpServerComponent {
  const component = planeManifest.versions[0].components.find(
    (candidate) => candidate.type === "mcp-server",
  );
  if (component?.type !== "mcp-server") {
    throw new Error("plane manifest is missing its mcp-server component");
  }
  return component;
}

describe("Plane plugin manifest", () => {
  it("validates as an unpublished Plane plugin draft", () => {
    const validated = validatePluginManifest(planeManifest);
    expect(validated.pluginKey).toBe("plane");
    expect(validated.versions[0].version).toBe("0.1.0");
    expect(
      allPluginManifests.map((candidate) => candidate.pluginKey),
    ).not.toContain("plane");
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
        path: "/mcp",
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
      "aesSecretKeySecretArn",
      "amqpUrlSecretArn",
      "certificateArn",
      "dbUrlSecretArn",
      "imageUri",
      "liveServerSecretKeySecretArn",
      "publicUrl",
      "s3AccessKeyIdSecretArn",
      "s3BucketName",
      "s3SecretAccessKeySecretArn",
      "secretKeySecretArn",
    ]);
    for (const spec of Object.values(infra.terraformInputs)) {
      expect(spec.description.length).toBeGreaterThan(0);
      expect(spec.type).toBe("string");
    }
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
    expect(planeManifest.versions[0].requiredOauthScopes).toEqual([]);
  });
});
