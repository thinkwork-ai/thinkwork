import { companyEtlManifest } from "./manifest";

export const companyEtlPluginPackage = {
  packageKey: "company-etl",
  sourceRoot: "plugins/company-etl",
  manifest: companyEtlManifest,
  ownedSources: [
    {
      kind: "manifest",
      path: "plugins/company-etl/src/manifest.ts",
      description:
        "Company ETL catalog manifest for the shell-only plugin identity.",
    },
    {
      kind: "docs",
      path: "plugins/company-etl/README.md",
      description: "Company ETL package ownership and deferred resource notes.",
    },
    {
      kind: "tests",
      path: "plugins/company-etl/test",
      description:
        "Company ETL package-local manifest and shell-boundary tests.",
    },
  ],
  compatibilityLinks: [],
} as const;

export { companyEtlManifest };
