/**
 * Twenty CRM plugin manifest.
 *
 * Rebuilds the Twenty managed application as an infrastructure-bundling
 * plugin:
 *
 *   - The `infrastructure` component maps onto the EXISTING `twenty`
 *     deployment-runner adapter. `terraformInputs` mirrors the adapter's
 *     `requiredInputs` for ENABLE/UPGRADE (contract-only — the engine's
 *     infra handler passes the managed_applications row's desired_config
 *     through verbatim; a U10 adoption preserves the live config).
 *   - The `mcp-server` component owns the row the legacy
 *     `reconcileTwentyManagedMcp` used to manage. Twenty's MCP endpoint is
 *     per-tenant (`https://<tenant-crm-host>/mcp`), so the manifest cannot
 *     carry a static URL: `endpointFrom` resolves the endpoint at provision
 *     time from the tenant's managed_applications row — `desired_config
 *     .publicUrl` is the adapter's required `publicUrl` input and is echoed
 *     verbatim as the `twenty_url` Terraform output, so the DB row is the
 *     authoritative source. Auth is `oauth-per-instance`: per-user OAuth
 *     with DCR against the Twenty instance itself (resource indicator =
 *     resolved endpoint; authorization server discovered from the
 *     endpoint's RFC 9728 protected-resource metadata) — exactly how the
 *     legacy managed row worked (`auth_config.oauth_resource` = the
 *     resolved MCP URL).
 *   - No skills component: tenant catalogs carry no Twenty skill today and
 *     the manifest does not invent content.
 *
 * `requiredOauthScopes` is empty by design: the authorization server is
 * per-instance, so its supported scopes are only discoverable at
 * activation time; the activation flow falls back to its default scope
 * set.
 */

export const twentyManifest = {
  pluginKey: "twenty",
  displayName: "Twenty CRM",
  description:
    "Customer-owned Twenty CRM runtime with dedicated data and storage, plus the Twenty MCP server for working CRM records from chat.",
  versions: [
    {
      version: "0.1.0",
      requiredOauthScopes: [],
      components: [
        {
          type: "mcp-server",
          key: "crm",
          displayName: "Twenty CRM",
          description:
            "CRM records (people, companies, opportunities, notes) on the tenant's deployed Twenty instance.",
          endpointFrom: {
            managedApp: "twenty",
            configKey: "publicUrl",
            path: "/mcp",
          },
          auth: { mode: "oauth-per-instance" },
          toolNotes: [
            "Twenty's MCP server exposes CRM object tools (people, companies, opportunities, tasks, notes); list tools first — the set varies by Twenty release.",
          ],
        },
        {
          type: "infrastructure",
          key: "runtime",
          managedAppKey: "twenty",
          // Mirrors the deployment-runner twenty adapter's requiredInputs
          // for ENABLE/UPGRADE (asserted by a parity test in packages/api).
          terraformInputs: {
            imageUri: {
              description:
                "Twenty CRM container image URI pinned with @sha256.",
              type: "string",
            },
            dbUrlSecretArn: {
              description: "Secrets Manager ARN containing PG_DATABASE_URL.",
              type: "string",
            },
            encryptionKeySecretArn: {
              description: "Secrets Manager ARN containing ENCRYPTION_KEY.",
              type: "string",
            },
            publicUrl: {
              description: "Public HTTPS origin for Twenty CRM.",
              type: "string",
            },
            certificateArn: {
              description: "ACM certificate ARN for the public HTTPS listener.",
              type: "string",
            },
          },
        },
      ],
    },
    {
      version: "0.2.0",
      requiredOauthScopes: [],
      components: [
        {
          type: "mcp-server",
          key: "crm",
          displayName: "Twenty CRM",
          description:
            "CRM records (people, companies, opportunities, notes) on the tenant's deployed Twenty instance.",
          endpointFrom: {
            managedApp: "twenty",
            configKey: "publicUrl",
            path: "/mcp",
          },
          auth: { mode: "oauth-per-instance" },
          recordLinkHints: {
            schemaVersion: 1,
            source: "plugin-manifest",
            routes: [
              {
                objectType: "opportunity",
                routeTemplate: "/object/opportunity/{id}",
                idFields: [
                  "id",
                  "opportunityId",
                  "record.id",
                  "opportunity.id",
                ],
                labelFields: [
                  "name",
                  "opportunityName",
                  "record.name",
                  "opportunity.name",
                ],
              },
            ],
          },
          toolNotes: [
            "Twenty's MCP server exposes CRM object tools (people, companies, opportunities, tasks, notes); list tools first — the set varies by Twenty release.",
          ],
        },
        {
          type: "infrastructure",
          key: "runtime",
          managedAppKey: "twenty",
          // Mirrors the deployment-runner twenty adapter's requiredInputs
          // for ENABLE/UPGRADE (asserted by a parity test in packages/api).
          terraformInputs: {
            imageUri: {
              description:
                "Twenty CRM container image URI pinned with @sha256.",
              type: "string",
            },
            dbUrlSecretArn: {
              description: "Secrets Manager ARN containing PG_DATABASE_URL.",
              type: "string",
            },
            encryptionKeySecretArn: {
              description: "Secrets Manager ARN containing ENCRYPTION_KEY.",
              type: "string",
            },
            publicUrl: {
              description: "Public HTTPS origin for Twenty CRM.",
              type: "string",
            },
            certificateArn: {
              description: "ACM certificate ARN for the public HTTPS listener.",
              type: "string",
            },
          },
        },
      ],
    },
  ],
};
