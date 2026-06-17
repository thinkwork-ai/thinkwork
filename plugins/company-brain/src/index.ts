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
  compatibilityLinks: [
    {
      path: "apps/web/src/components/settings/SettingsCogneeApplication.tsx",
      reason:
        "Company Brain operator UI is still owned by the shared web app during migration.",
      removal: "THNK-31 U5 renders plugin-owned UI from plugin detail.",
    },
    {
      path: "packages/api/src/lib/company-brain",
      reason:
        "Company Brain API helpers are still owned by the shared API package during migration.",
      removal:
        "THNK-31 U6 moves plugin-specific API helpers behind package exports.",
    },
    {
      path: "packages/api/src/lib/context-engine/providers/company-brain.ts",
      reason:
        "Company Brain context provider is still owned by the shared API package during migration.",
      removal:
        "THNK-31 U6 moves plugin-specific API helpers behind package exports.",
    },
    {
      path: "packages/api/src/lib/knowledge-graph/cognee-client.ts",
      reason:
        "Company Brain substrate client is still owned by the shared API package during migration.",
      removal:
        "THNK-31 U6 moves plugin-specific API helpers behind package exports.",
    },
  ],
} as const;

export { companyBrainManifest };
export { cogneeAdapter } from "./deployment/cognee-managed-app";
