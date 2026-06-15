import { companyBrainManifest } from "./manifest";

export const companyBrainPluginPackage = {
  packageKey: "company-brain",
  sourceRoot: "plugins/company-brain",
  manifest: companyBrainManifest,
} as const;

export { companyBrainManifest };
