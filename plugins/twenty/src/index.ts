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
  compatibilityLinks: [
    {
      path: "packages/api/src/lib/plugins/twenty-cutover.ts",
      reason:
        "Twenty MCP cutover helper is still owned by the shared API package.",
      removal:
        "THNK-31 U6 moves plugin-specific API helpers behind package exports.",
    },
  ],
} as const;

export { twentyManifest };
export { twentyAdapter } from "./deployment/managed-app";
