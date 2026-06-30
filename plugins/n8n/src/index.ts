import { n8nManifest, N8N_PLUGIN_KEY } from "./manifest";

export const n8nPluginPackage = {
  packageKey: N8N_PLUGIN_KEY,
  sourceRoot: "plugins/n8n",
  manifest: n8nManifest,
  ownedSources: [
    {
      kind: "manifest",
      path: "plugins/n8n/src/manifest.ts",
      description: "n8n catalog manifest and versioned component contract.",
    },
    {
      kind: "deployment",
      path: "plugins/n8n/src/deployment",
      description: "n8n managed-app adapter and package image build contract.",
    },
    {
      kind: "terraform",
      path: "plugins/n8n/terraform/n8n",
      description:
        "n8n queue-mode Terraform module for ECS, database, Valkey, storage, secrets, ALB, and status outputs.",
    },
    {
      kind: "runtime",
      path: "plugins/n8n/runtime",
      description:
        "Thin n8n wrapper image and task-runner allow-list template for pinned public Code node packages.",
    },
    {
      kind: "web",
      path: "plugins/n8n/n8n-app",
      description:
        "Native ThinkWork n8n installed app surface for workflow and execution operations.",
    },
    {
      kind: "web",
      path: "plugins/n8n/src/web",
      description:
        "Package-owned contracts for n8n Plugin Detail package settings.",
    },
    {
      kind: "skills",
      path: "plugins/n8n/src/skills",
      description:
        "n8n workflow operator instructions seeded through the plugin catalog.",
    },
    {
      kind: "smoke",
      path: "plugins/n8n/smoke",
      description: "n8n managed-app and native MCP smoke validation scripts.",
    },
    {
      kind: "tests",
      path: "plugins/n8n/test",
      description: "n8n package-local manifest and contract tests.",
    },
    {
      kind: "docs",
      path: "plugins/n8n/README.md",
      description: "n8n package ownership, scope, and verification notes.",
    },
  ],
  compatibilityLinks: [],
} as const;

export { n8nManifest };
export {
  N8N_MCP_ENDPOINT_PATH,
  N8N_PLUGIN_KEY,
  N8N_PLUGIN_VERSION,
  N8N_SERVICE_CREDENTIAL_KIND,
  N8N_SERVICE_CREDENTIAL_SECRET_JSON_KEY,
  N8N_WORKFLOW_OPERATOR_SKILL_MD,
  N8N_WORKFLOW_OPERATOR_SKILL_SLUG,
} from "./manifest";
export { n8nAdapter } from "./deployment/managed-app";
export { buildN8nPackageImageBuildContract } from "./deployment/image-build";
export { normalizeN8nPackageConfig } from "./package-config";
