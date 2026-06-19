import { n8nDraftManifest, N8N_PLUGIN_KEY } from "./manifest";

export const n8nPluginScaffold = {
  packageKey: N8N_PLUGIN_KEY,
  sourceRoot: "plugins/n8n",
  draftManifest: n8nDraftManifest,
  ownedSources: [
    {
      kind: "manifest",
      path: "plugins/n8n/src/manifest.ts",
      description:
        "Draft n8n catalog manifest intent and publication gates for THNK-50.",
    },
    {
      kind: "deployment",
      path: "plugins/n8n/src/deployment",
      description:
        "Package-owned n8n managed-app adapter source for the deployment-runner contract.",
    },
    {
      kind: "terraform",
      path: "plugins/n8n/terraform/n8n",
      description:
        "Planned n8n queue-mode Terraform module for ECS, database, Valkey, storage, secrets, ALB, and status outputs.",
    },
    {
      kind: "runtime",
      path: "plugins/n8n/runtime",
      description:
        "Planned thin n8n wrapper image assets for pinned public Code node packages.",
    },
    {
      kind: "web",
      path: "plugins/n8n/src/web",
      description:
        "Planned package-owned contracts for n8n Plugin Detail package settings.",
    },
    {
      kind: "smoke",
      path: "plugins/n8n/smoke",
      description:
        "Planned n8n managed-app and native MCP smoke validation scripts.",
    },
    {
      kind: "tests",
      path: "plugins/n8n/test",
      description: "n8n package-local scaffold, manifest, and contract tests.",
    },
    {
      kind: "docs",
      path: "plugins/n8n/README.md",
      description: "n8n package ownership, scope, and verification notes.",
    },
  ],
  compatibilityLinks: [],
  publicationStatus: "deferred",
  publicationGate:
    "THNK-50 U7 publishes n8n after U2 adapter and U5 service credential auth contracts are implemented.",
} as const;

export { n8nDraftManifest };
export { n8nAdapter } from "./deployment/managed-app";
