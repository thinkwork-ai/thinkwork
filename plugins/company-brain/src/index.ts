import { companyBrainManifest } from "./manifest";

export const companyBrainPluginPackage = {
  packageKey: "company-brain",
  sourceRoot: "plugins/company-brain",
  manifest: companyBrainManifest,
  ownedSources: [
    {
      kind: "manifest",
      path: "plugins/company-brain/src/manifest.ts",
      description:
        "Company Brain catalog manifest and internal Brain substrate component contract.",
    },
    {
      kind: "smoke",
      path: "plugins/company-brain/smoke",
      description:
        "Company Brain entitlement, operations, context engine, and substrate smoke validation scripts.",
    },
    {
      kind: "deployment",
      path: "plugins/company-brain/src/deployment/cognee-managed-app.ts",
      description: "Company Brain internal substrate managed-app adapter.",
    },
    {
      kind: "terraform",
      path: "plugins/company-brain/terraform/cognee",
      description: "Company Brain internal substrate Terraform module.",
    },
    {
      kind: "runtime",
      path: "plugins/company-brain/runtime/cognee/Dockerfile",
      description: "Company Brain internal substrate runtime image source.",
    },
    {
      kind: "api",
      path: "plugins/company-brain/src/api",
      description:
        "Company Brain migration helpers, context provider, substrate client, and cluster identity utilities.",
    },
    {
      kind: "tests",
      path: "plugins/company-brain/test",
      description: "Company Brain package-local manifest and contract tests.",
    },
    {
      kind: "docs",
      path: "plugins/company-brain/README.md",
      description:
        "Company Brain customer-facing ownership and substrate migration notes.",
    },
  ],
  compatibilityLinks: [],
} as const;

export { companyBrainManifest };
export { cogneeAdapter } from "./deployment/cognee-managed-app";
export * from "./api/cognee-client";
export * from "./api/cognee-memory-scope";
export * from "./api/cognee-cluster-identity";
export * from "./api/context-engine-provider";
export * from "./api/migration";
