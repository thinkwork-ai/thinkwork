/**
 * Company Brain plugin manifest — v0.1.0 (THNK-15 U1).
 *
 * Company Brain is the customer-facing premium product. The infrastructure
 * component is backed by the existing internal Cognee managed-app adapter, but
 * manifest display copy keeps Cognee out of the customer-facing catalog.
 *
 * V1 proves the premium plugin shell plus direct agent access:
 *   - always visible in the catalog
 *   - install gated by a ThinkWork-provided key
 *   - internal Brain substrate provisioned/adopted through managed-app infra
 *   - Brain substrate MCP registered as a plugin-owned server for Pi/direct MCP
 *   - no rendered plugin UI surface and no Full Brain runtime component
 */

export const companyBrainManifest = {
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
        {
          type: "mcp-server",
          key: "brain",
          displayName: "Company Brain",
          description:
            "Direct MCP access to the tenant's Company Brain substrate for memory capture, recall, graph search, and substrate-native operations.",
          endpointFrom: {
            managedApp: "cognee",
            configKey: "cogneeEndpoint",
            path: "/mcp-server/http",
          },
          auth: { mode: "none" },
          toolNotes: [
            "Company Brain MCP is tenant-internal and plugin-owned; agents should discover the live tool list before calling substrate-native memory or graph operations.",
            "Use direct MCP/API access from Pi for Company Brain reads and writes. GraphQL is control-plane only and must not be required for agent memory operations.",
          ],
        },
      ],
    },
  ],
};
