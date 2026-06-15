import { describe, expect, it } from "vitest";

import {
  validatePluginManifest,
  type InfrastructureComponent,
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

describe("Plane plugin manifest", () => {
  it("validates as an unpublished infrastructure-and-skills draft", () => {
    const validated = validatePluginManifest(planeManifest);
    expect(validated.pluginKey).toBe("plane");
    expect(validated.versions[0].version).toBe("0.1.0");
    expect(
      allPluginManifests.map((candidate) => candidate.pluginKey),
    ).not.toContain("plane");
    expect(
      validated.versions[0].components.map((component) => component.type),
    ).toEqual(["infrastructure", "skills"]);
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
    expect(skill.skillMd).toContain("Resolve the workspace and project");
    expect(skill.skillMd).toContain("ENG-42");
    expect(skill.skillMd).toContain("Plane UUID");
    expect(skill.skillMd).toContain("Never use a tenant-wide Plane API key");
    expect(skill.skillMd).toContain("re-read the record");
  });

  it("does not declare Plane MCP until PAT header auth is modeled", () => {
    expect(
      planeManifest.versions[0].components.some(
        (component) => component.type === "mcp-server",
      ),
    ).toBe(false);
    expect(planeManifest.versions[0].requiredOauthScopes).toEqual([]);
  });
});
