import type { PluginManifest } from "@thinkwork/plugin-catalog/contracts";

export const COMPANY_DATA_SETTINGS_SURFACE =
  "settings.plugins.detail.tab" as const;

export const companyDataManifest = {
  pluginKey: "company-data",
  displayName: "ThinkWork Data Warehouse",
  description:
    "Establishes a governed operational facts substrate for agent and UI reads. Extraction runners, projection databases, Context Engine providers, MCP tools, analytics, BI, and source-system writes belong to later ThinkWork Data Warehouse releases.",
  versions: [
    {
      version: "0.1.0",
      requiredOauthScopes: [],
      capabilities: [],
      components: [
        {
          type: "ui-surface",
          key: "settings",
          displayName: "ThinkWork Data Warehouse settings",
          intendedMount: COMPANY_DATA_SETTINGS_SURFACE,
        },
      ],
    },
  ],
} satisfies PluginManifest;
