import { describe, expect, it } from "vitest";

import {
  validatePluginManifest,
  type InfrastructureComponent,
  type McpServerComponent,
} from "@thinkwork/plugin-catalog/contracts";

import { companyBrainManifest } from "../src/manifest";

const latestVersion =
  companyBrainManifest.versions[companyBrainManifest.versions.length - 1]!;

describe("Company Brain plugin manifest", () => {
  it("validates as a premium infrastructure plus MCP plugin", () => {
    const validated = validatePluginManifest(companyBrainManifest);
    expect(validated.pluginKey).toBe("company-brain");
    expect(validated.displayName).toBe("Company Brain");
    expect(validated.premium).toEqual({
      entitlementProductKey: "company-brain",
      installKeyRequired: true,
      installKeyPrompt:
        "Enter the Company Brain install key provided by ThinkWork to unlock this premium plugin for your tenant.",
    });
    expect(validated.versions.map((version) => version.version)).toEqual([
      "0.1.0",
      "0.1.1",
    ]);
    expect(validated.versions[0].components).toHaveLength(1);
    expect(latestVersion.requiredOauthScopes).toEqual([]);
    expect(latestVersion.components).toHaveLength(2);
    expect(latestVersion.components[0].type).toBe("infrastructure");
    expect(latestVersion.components[1].type).toBe("mcp-server");
  });

  it("declares the internal Cognee-backed Brain substrate component", () => {
    const component = latestVersion.components[0] as InfrastructureComponent;
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

  it("declares Company Brain MCP as a plugin-owned direct agent surface", () => {
    const component = latestVersion.components[1] as McpServerComponent;
    expect(component).toMatchObject({
      type: "mcp-server",
      key: "brain",
      displayName: "Company Brain",
      endpointFrom: {
        managedApp: "cognee",
        configKey: "cogneeEndpoint",
        path: "/mcp-server/http",
      },
      auth: { mode: "none" },
    });
    expect(component.toolNotes?.join("\n")).toMatch(/direct MCP\/API access/i);
  });

  it("does not declare Full Brain runtime, skills, or rendered UI surfaces in v1", () => {
    const componentTypes = latestVersion.components.map(
      (component) => component.type,
    );
    expect(componentTypes).toEqual(["infrastructure", "mcp-server"]);
    expect(latestVersion.requiredOauthScopes).toEqual([]);
  });

  it("keeps customer-facing copy on Company Brain rather than Cognee", () => {
    const customerFacingText = [
      companyBrainManifest.displayName,
      companyBrainManifest.description,
      companyBrainManifest.premium?.installKeyPrompt,
      ...Object.values(
        (
          latestVersion.components[0] as InfrastructureComponent
        ).terraformInputs,
      ).map((spec) => spec.description),
    ].join("\n");

    expect(customerFacingText).toContain("Company Brain");
    expect(customerFacingText).not.toMatch(/\bCognee\b/);
  });
});
