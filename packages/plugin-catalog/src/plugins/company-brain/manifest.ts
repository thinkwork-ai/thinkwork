/**
 * Company Brain plugin manifest — v0.1.0 (THNK-15 U1).
 *
 * Company Brain is the customer-facing premium product. The infrastructure
 * component is backed by the existing internal Cognee managed-app adapter, but
 * manifest display copy keeps Cognee out of the customer-facing catalog.
 *
 * V1 proves the premium plugin shell only:
 *   - always visible in the catalog
 *   - install gated by a ThinkWork-provided key
 *   - internal Brain substrate provisioned/adopted through managed-app infra
 *   - no rendered plugin UI surface and no Full Brain runtime component
 */

import type { PluginManifest } from "../../contracts";

export const companyBrainManifest: PluginManifest = {
  pluginKey: "company-brain",
  displayName: "Company Brain",
  description:
    "Premium knowledge graph substrate for organizing company memory and powering the Memory / Ontology workspace.",
  premium: {
    entitlementProductKey: "company-brain",
    installKeyRequired: true,
    installKeyPrompt:
      "Enter the Company Brain install key provided by ThinkWork to unlock this premium plugin for your tenant.",
  },
  versions: [
    {
      version: "0.1.0",
      requiredOauthScopes: [],
      components: [
        {
          type: "infrastructure",
          key: "brain-substrate",
          managedAppKey: "cognee",
          // Mirrors the deployment-runner Cognee adapter's requiredInputs
          // for ENABLE/UPGRADE. The adapter remains internal implementation
          // machinery; the catalog presents the component as Company Brain's
          // knowledge graph substrate.
          terraformInputs: {
            imageUri: {
              description:
                "Company Brain substrate container image URI pinned with @sha256.",
              type: "string",
            },
            dbPasswordSecretArn: {
              description:
                "Secrets Manager ARN containing the dedicated Brain substrate database password.",
              type: "string",
            },
            bedrockModelResourceArns: {
              description:
                "Explicit Bedrock model or inference-profile ARNs for Company Brain providers.",
              type: "list(string)",
            },
          },
        },
      ],
    },
  ],
};
