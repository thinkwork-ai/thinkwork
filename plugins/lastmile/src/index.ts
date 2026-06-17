import { lastmileManifest } from "./manifest";

export const lastmilePluginPackage = {
  packageKey: "lastmile",
  sourceRoot: "plugins/lastmile",
  manifest: lastmileManifest,
  ownedSources: [
    {
      kind: "manifest",
      path: "plugins/lastmile/src/manifest.ts",
      description: "LastMile catalog manifest and MCP component contract.",
    },
    {
      kind: "api",
      path: "plugins/lastmile/src/api/tasks-adapter.ts",
      description:
        "LastMile task adapter that normalizes MCP task provider calls.",
    },
    {
      kind: "api",
      path: "plugins/lastmile/src/discovery.fixture.ts",
      description:
        "Recorded protected-resource discovery metadata used by package drift tests.",
    },
    {
      kind: "smoke",
      path: "plugins/lastmile/smoke",
      description: "LastMile live plugin smoke validation script.",
    },
    {
      kind: "tests",
      path: "plugins/lastmile/test",
      description: "LastMile package-local discovery and manifest drift tests.",
    },
    {
      kind: "docs",
      path: "plugins/lastmile/README.md",
      description: "LastMile package ownership and verification notes.",
    },
  ],
  compatibilityLinks: [],
} as const;

export { lastmileManifest };
export { lastmileDiscoveryFixture } from "./discovery.fixture";
export * from "./api/tasks-adapter";
