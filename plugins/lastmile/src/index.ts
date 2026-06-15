import { lastmileManifest } from "./manifest";

export const lastmilePluginPackage = {
  packageKey: "lastmile",
  sourceRoot: "plugins/lastmile",
  manifest: lastmileManifest,
} as const;

export { lastmileManifest };
export { lastmileDiscoveryFixture } from "./discovery.fixture";
