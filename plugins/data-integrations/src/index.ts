import { dataIntegrationsManifest } from "./manifest";

export const dataIntegrationsPluginPackage = {
  packageKey: "data-integrations",
  sourceRoot: "plugins/data-integrations",
  manifest: dataIntegrationsManifest,
  ownedSources: [
    {
      kind: "manifest",
      path: "plugins/data-integrations/src/manifest.ts",
      description:
        "Data Integrations catalog manifest for the shell-only plugin identity.",
    },
    {
      kind: "docs",
      path: "plugins/data-integrations/README.md",
      description:
        "Data Integrations package ownership and deferred resource notes.",
    },
    {
      kind: "tests",
      path: "plugins/data-integrations/test",
      description:
        "Data Integrations package-local manifest and shell-boundary tests.",
    },
  ],
  compatibilityLinks: [],
} as const;

export { dataIntegrationsManifest };
