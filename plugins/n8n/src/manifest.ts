export const N8N_PLUGIN_KEY = "n8n";

export const N8N_PLANNED_VERSION = "0.1.0";

export const N8N_PUBLICATION_GATES = [
  {
    unit: "U2",
    requirement:
      "Register a real n8n managed-app adapter before declaring managedAppKey n8n.",
  },
  {
    unit: "U5",
    requirement:
      "Add tenant service credential MCP auth before declaring native n8n MCP.",
  },
  {
    unit: "U7",
    requirement:
      "Publish the final manifest, generated catalog registry entry, smokes, docs, and agent instructions.",
  },
] as const;

export const n8nDraftManifest = {
  pluginKey: N8N_PLUGIN_KEY,
  displayName: "n8n",
  description:
    "Draft scaffold for a self-hosted n8n managed application plugin with queue-mode runtime, package-aware wrapper images, and native n8n MCP.",
  publicationStatus: "draft-scaffold",
  plannedVersion: N8N_PLANNED_VERSION,
  plannedComponents: [
    {
      type: "infrastructure",
      key: "runtime",
      plannedManagedAppKey: "n8n",
      publicationGate: "U2",
      description:
        "Queue-mode n8n runtime with main and worker services, thinkwork_n8n database, dedicated Valkey queue, storage, secrets, and managed-app evidence.",
    },
    {
      type: "mcp-server",
      key: "workflow-management",
      publicationGate: "U5",
      description:
        "Native instance-level n8n MCP resolved from the managed-app public URL and authenticated with a tenant service credential.",
    },
    {
      type: "ui-surface",
      key: "package-settings",
      publicationGate: "U6",
      description:
        "Plugin Detail settings for pinned public npm packages that drive managed-app desired config and image evidence.",
    },
    {
      type: "skills",
      key: "workflow-operator-instructions",
      publicationGate: "U7",
      description:
        "Agent instructions for inspecting, drafting, testing, and running n8n workflows while leaving publish and unpublish to the shared operator.",
    },
  ],
  excludedRuntimeSource: [
    "LastMile custom nodes",
    "LastMile credentials",
    "LastMile workflow exports",
    "private npm registries",
    "arbitrary Dockerfile edits",
  ],
  publicationGates: N8N_PUBLICATION_GATES,
} as const;

export type N8nDraftManifest = typeof n8nDraftManifest;
