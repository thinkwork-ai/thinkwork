import { planeManifest } from "./manifest";

export const planePluginPackage = {
  packageKey: "plane",
  sourceRoot: "plugins/plane",
  manifest: planeManifest,
  ownedSources: [
    {
      kind: "manifest",
      path: "plugins/plane/src/manifest.ts",
      description: "Plane catalog manifest and versioned component contract.",
    },
    {
      kind: "smoke",
      path: "plugins/plane/smoke",
      description: "Plane managed-app and MCP smoke validation scripts.",
    },
    {
      kind: "deployment",
      path: "plugins/plane/src/deployment/managed-app.ts",
      description: "Plane managed-app deployment adapter.",
    },
    {
      kind: "tests",
      path: "plugins/plane/test",
      description: "Plane package-local manifest and contract tests.",
    },
    {
      kind: "docs",
      path: "plugins/plane/README.md",
      description: "Plane package ownership and migration notes.",
    },
  ],
  compatibilityLinks: [
    {
      path: "terraform/modules/app/plane",
      reason:
        "Plane Terraform source still ships from the legacy app module path.",
      removal: "THNK-31 U4 moves managed-app Terraform source under plugins.",
    },
  ],
} as const;

export { planeManifest };
export { planeAdapter } from "./deployment/managed-app";
