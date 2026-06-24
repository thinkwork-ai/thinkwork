import { companyDataManifest } from "./manifest";

export const companyDataPluginPackage = {
  packageKey: "company-data",
  sourceRoot: "plugins/company-data",
  manifest: companyDataManifest,
  ownedSources: [
    {
      kind: "manifest",
      path: "plugins/company-data/src/manifest.ts",
      description:
        "Company Data catalog manifest for the shell-only plugin identity.",
    },
    {
      kind: "docs",
      path: "plugins/company-data/README.md",
      description:
        "Company Data package ownership and deferred resource notes.",
    },
    {
      kind: "tests",
      path: "plugins/company-data/test",
      description:
        "Company Data package-local manifest and shell-boundary tests.",
    },
  ],
  compatibilityLinks: [],
} as const;

export { companyDataManifest };
