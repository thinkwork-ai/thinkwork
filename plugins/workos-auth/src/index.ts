import { workosAuthManifest } from "./manifest";

export const workosAuthPluginPackage = {
  packageKey: "workos-auth",
  sourceRoot: "plugins/workos-auth",
  manifest: workosAuthManifest,
  ownedSources: [
    {
      kind: "manifest",
      path: "plugins/workos-auth/src/manifest.ts",
      description:
        "WorkOS Auth catalog manifest and Cognito auth-provider component contract.",
    },
    {
      kind: "api",
      path: "plugins/workos-auth/src/provider-contract.ts",
      description:
        "WorkOS Auth provider keys, admin config fields, and U1-approved public option metadata.",
    },
    {
      kind: "tests",
      path: "plugins/workos-auth/test",
      description: "WorkOS Auth package-local manifest and contract tests.",
    },
  ],
  compatibilityLinks: [],
} as const;

export { workosAuthManifest };
export * from "./provider-contract";
