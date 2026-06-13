import { describe, expect, it } from "vitest";

import {
  validatePluginManifest,
  type InfrastructureComponent,
} from "../contracts";
import { allPluginManifests, companyBrainManifest } from "../plugins";

describe("Company Brain plugin manifest", () => {
  it("is registered in the published catalog list", () => {
    expect(
      allPluginManifests.map((candidate) => candidate.pluginKey),
    ).toContain("company-brain");
  });

  it("validates as a premium infrastructure-only plugin", () => {
    const validated = validatePluginManifest(companyBrainManifest);
    expect(validated.pluginKey).toBe("company-brain");
    expect(validated.displayName).toBe("Company Brain");
    expect(validated.premium).toEqual({
      entitlementProductKey: "company-brain",
      installKeyRequired: true,
      installKeyPrompt:
        "Enter the Company Brain install key provided by ThinkWork to unlock this premium plugin for your tenant.",
    });
    expect(validated.versions[0].requiredOauthScopes).toEqual([]);
    expect(validated.versions[0].components).toHaveLength(1);
    expect(validated.versions[0].components[0].type).toBe("infrastructure");
  });

  it("declares the internal Cognee-backed Brain substrate component", () => {
    const component = companyBrainManifest.versions[0]
      .components[0] as InfrastructureComponent;
    expect(component).toMatchObject({
      type: "infrastructure",
      key: "brain-substrate",
      managedAppKey: "cognee",
    });
    expect(Object.keys(component.terraformInputs).sort()).toEqual([
      "bedrockModelResourceArns",
      "dbPasswordSecretArn",
      "imageUri",
    ]);
    expect(component.terraformInputs.bedrockModelResourceArns.type).toBe(
      "list(string)",
    );
  });

  it("does not declare Full Brain runtime, MCP, skills, or rendered UI surfaces in v1", () => {
    const componentTypes = companyBrainManifest.versions[0].components.map(
      (component) => component.type,
    );
    expect(componentTypes).toEqual(["infrastructure"]);
    expect(companyBrainManifest.versions[0].requiredOauthScopes).toEqual([]);
  });

  it("keeps customer-facing copy on Company Brain rather than Cognee", () => {
    const customerFacingText = [
      companyBrainManifest.displayName,
      companyBrainManifest.description,
      companyBrainManifest.premium?.installKeyPrompt,
      ...Object.values(
        (
          companyBrainManifest.versions[0]
            .components[0] as InfrastructureComponent
        ).terraformInputs,
      ).map((spec) => spec.description),
    ].join("\n");

    expect(customerFacingText).toContain("Company Brain");
    expect(customerFacingText).not.toMatch(/\bCognee\b/);
  });
});
