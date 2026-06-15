/**
 * Replace placeholders with source-backed values from the contribution plan.
 * Place this file at plugins/<plugin-key>/src/manifest.ts.
 * Validate with validatePluginManifest at the catalog boundary and add a
 * manifest-specific test.
 */
export const examplePluginManifest = {
  pluginKey: "customer-product",
  displayName: "Customer Product",
  description:
    "Customer-facing product description. Keep internal substrate names in maintainer notes unless they are part of the product.",
  premium: {
    entitlementProductKey: "customer-product",
    installKeyRequired: true,
    installKeyPrompt:
      "Enter the Customer Product install key provided by ThinkWork to unlock this premium plugin for your tenant.",
  },
  versions: [
    {
      version: "0.1.0",
      requiredOauthScopes: [],
      components: [
        {
          type: "infrastructure",
          key: "runtime",
          // Must be a supported key from packages/deployment-runner/src/apps/registry.ts.
          // If no supported adapter fits, stop and write an adapter gap review.
          managedAppKey: "twenty",
          terraformInputs: {
            imageUri: {
              description:
                "Container image URI pinned with @sha256 for the managed runtime.",
              type: "string",
            },
          },
        },
      ],
    },
  ],
};
