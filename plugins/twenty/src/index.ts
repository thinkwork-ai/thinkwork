import { twentyManifest } from "./manifest";

export const twentyPluginPackage = {
  packageKey: "twenty",
  sourceRoot: "plugins/twenty",
  manifest: twentyManifest,
} as const;

export { twentyManifest };
