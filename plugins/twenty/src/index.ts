import { twentyManifest } from "./manifest";

export const twentyPluginPackage = {
  packageKey: "twenty",
  sourceRoot: "plugins/twenty",
  manifest: twentyManifest,
  ownedSources: [
    {
      kind: "manifest",
      path: "plugins/twenty/src/manifest.ts",
      description: "Twenty catalog manifest and versioned component contract.",
    },
    {
      kind: "smoke",
      path: "plugins/twenty/smoke",
      description: "Twenty managed-app and MCP OAuth smoke validation scripts.",
    },
    {
      kind: "deployment",
      path: "plugins/twenty/src/deployment/managed-app.ts",
      description: "Twenty managed-app deployment adapter.",
    },
    {
      kind: "terraform",
      path: "plugins/twenty/terraform/twenty",
      description: "Twenty managed-app Terraform module.",
    },
    {
      kind: "api",
      path: "plugins/twenty/src/api/cutover.ts",
      description: "Twenty MCP cutover orchestration contract.",
    },
    {
      kind: "tests",
      path: "plugins/twenty/test",
      description: "Twenty package-local manifest and contract tests.",
    },
    {
      kind: "docs",
      path: "plugins/twenty/README.md",
      description: "Twenty package ownership and migration notes.",
    },
  ],
  compatibilityLinks: [],
} as const;

export { twentyManifest };
export { twentyAdapter } from "./deployment/managed-app";
export * from "./api/cutover";
