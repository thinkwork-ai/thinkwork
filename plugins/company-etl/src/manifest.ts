import type { PluginManifest } from "@thinkwork/plugin-catalog/contracts";

export const COMPANY_ETL_SETTINGS_SURFACE =
  "settings.plugins.detail.tab" as const;

export const companyEtlManifest = {
  pluginKey: "company-etl",
  displayName: "Company ETL",
  description:
    "Provides the tenant-managed ETL shell for moving data between SaaS apps, databases, and agent-accessible systems. Analytics dashboards, BI, warehouse query UI, and Company Data projection behavior belong to separate plugins.",
  versions: [
    {
      version: "0.1.0",
      requiredOauthScopes: [],
      capabilities: [],
      components: [
        {
          type: "ui-surface",
          key: "settings",
          displayName: "Company ETL settings",
          intendedMount: COMPANY_ETL_SETTINGS_SURFACE,
        },
      ],
    },
  ],
} satisfies PluginManifest;
