import { lakehouseManifest } from "./manifest";

export const lakehousePluginPackage = {
  packageKey: "lakehouse",
  sourceRoot: "plugins/lakehouse",
  manifest: lakehouseManifest,
  ownedSources: [
    {
      kind: "manifest",
      path: "plugins/lakehouse/src/manifest.ts",
      description:
        "LakeHouse catalog manifest for the shell-only plugin identity.",
    },
    {
      kind: "docs",
      path: "plugins/lakehouse/README.md",
      description: "LakeHouse package ownership and deferred resource notes.",
    },
    {
      kind: "tests",
      path: "plugins/lakehouse/test",
      description: "LakeHouse package-local manifest and shell-boundary tests.",
    },
  ],
  compatibilityLinks: [],
} as const;

export { lakehouseManifest };
export * from "./edge-integration";
