import type { PluginManifest } from "@thinkwork/plugin-catalog/contracts";

export const DATA_INTEGRATIONS_SETTINGS_SURFACE =
  "settings.plugins.detail.tab" as const;

export const dataIntegrationsManifest = {
  pluginKey: "data-integrations",
  displayName: "Data Integrations",
  description:
    "Deploys a tenant-managed ELT integration runtime for moving data between SaaS apps, databases, warehouses, and agent-accessible systems. Analytics dashboards, BI, and lakehouse query UI belong to separate plugins.",
  versions: [
    {
      version: "0.1.0",
      requiredOauthScopes: [],
      capabilities: [],
      components: [
        {
          type: "ui-surface",
          key: "settings",
          displayName: "Data Integrations settings",
          intendedMount: DATA_INTEGRATIONS_SETTINGS_SURFACE,
        },
      ],
    },
  ],
} satisfies PluginManifest;
