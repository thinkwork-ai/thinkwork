import { describe, expect, it } from "vitest";

import {
  allPluginManifests,
  customerProductManifest,
  validatePluginManifest,
  type InfrastructureComponent,
} from "@thinkwork/plugin-catalog";
import { customerProductPluginPackage } from "@thinkwork/plugin-customer-product";

describe("Customer Product plugin manifest", () => {
  it("declares the root plugin package boundary", () => {
    expect(customerProductPluginPackage).toMatchObject({
      packageKey: "customer-product",
      sourceRoot: "plugins/customer-product",
      manifest: customerProductManifest,
    });
  });

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
