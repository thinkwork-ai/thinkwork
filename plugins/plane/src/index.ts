import { planeManifest } from "./manifest";

export const planePluginPackage = {
  packageKey: "plane",
  sourceRoot: "plugins/plane",
  manifest: planeManifest,
} as const;

export { planeManifest };
