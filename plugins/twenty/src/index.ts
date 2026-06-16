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
      path: "packages/deployment-runner/src/apps/twenty.ts",
      reason:
        "Twenty managed-app adapter has not moved to the plugin package yet.",
      removal:
        "THNK-31 U3 moves managed-app deployment adapters behind plugins.",
    },
    {
      path: "terraform/modules/app/twenty",
      reason:
        "Twenty Terraform source still ships from the legacy app module path.",
      removal: "THNK-31 U4 moves managed-app Terraform source under plugins.",
    },
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
