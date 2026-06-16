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
  compatibilityLinks: [
    {
      path: "packages/api/src/lib/lastmile/tasks-adapter.ts",
      reason:
        "LastMile task adapter is still owned by the shared API package during migration.",
      removal:
        "THNK-31 U6 moves plugin-specific API helpers behind package exports.",
    },
  ],
} as const;

export { lastmileManifest };
export { lastmileDiscoveryFixture } from "./discovery.fixture";
