import { describe, expect, it } from "vitest";

import {
  validatePluginManifest,
  type InfrastructureComponent,
} from "../contracts";
import { allPluginManifests, customerProductManifest } from "../plugins";

describe("Customer Product plugin manifest", () => {
  it("is registered in the published catalog list", () => {
    expect(
      allPluginManifests.map((candidate) => candidate.pluginKey),
    ).toContain("customer-product");
  });

  it("validates as a premium plugin", () => {
    const validated = validatePluginManifest(customerProductManifest);
    expect(validated.pluginKey).toBe("customer-product");
    expect(validated.premium).toEqual({
      entitlementProductKey: "customer-product",
      installKeyRequired: true,
      installKeyPrompt:
        "Enter the Customer Product install key provided by ThinkWork to unlock this premium plugin for your tenant.",
    });
  });

  it("declares infrastructure against a supported managed-app adapter", () => {
    const infra = customerProductManifest.versions[0].components.find(
      (component) => component.type === "infrastructure",
    ) as InfrastructureComponent | undefined;

    expect(infra?.managedAppKey).toBe("twenty");
    expect(Object.keys(infra?.terraformInputs ?? {})).toContain("imageUri");
  });
});
