import type { PluginManifest } from "@thinkwork/plugin-catalog/contracts";

export const LAKEHOUSE_SETTINGS_SURFACE =
  "settings.plugins.detail.tab" as const;

export const lakehouseManifest = {
  pluginKey: "lakehouse",
  displayName: "LakeHouse",
  description:
    "LakeHouse solution shell for enterprise data platform planning. Installs the product identity now while datalake, warehouse, query, monitoring, automation, MCP, skills, and infrastructure capabilities are deferred.",
  versions: [
    {
      version: "0.1.0",
      requiredOauthScopes: [],
      capabilities: [],
      components: [
        {
          type: "ui-surface",
          key: "settings",
          displayName: "LakeHouse settings",
          intendedMount: LAKEHOUSE_SETTINGS_SURFACE,
        },
      ],
    },
  ],
} satisfies PluginManifest;
