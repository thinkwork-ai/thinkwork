import type { PluginManifest } from "@thinkwork/plugin-catalog/contracts";

export const LAKEHOUSE_SETTINGS_SURFACE =
  "settings.plugins.detail.tab" as const;

export const lakehouseManifest = {
  pluginKey: "lakehouse",
  displayName: "LakeHouse",
  description:
    "LakeHouse solution for enterprise data platform planning, spanning datalake, warehouse, query, monitoring, automation, MCP, skills, and infrastructure capabilities.",
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
