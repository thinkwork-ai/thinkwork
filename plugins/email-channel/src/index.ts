import { emailChannelManifest } from "./manifest";

export const emailChannelPluginPackage = {
  packageKey: "email-channel",
  sourceRoot: "plugins/email-channel",
  manifest: emailChannelManifest,
  ownedSources: [
    {
      kind: "manifest",
      path: "plugins/email-channel/src/manifest.ts",
      description:
        "Email Channel catalog manifest and provider capability contract.",
    },
    {
      kind: "api",
      path: "plugins/email-channel/src/provider-contract.ts",
      description:
        "Email Channel provider keys and package-local channel contract metadata.",
    },
    {
      kind: "tests",
      path: "plugins/email-channel/test",
      description:
        "Email Channel package-local manifest and provider scope tests.",
    },
    {
      kind: "docs",
      path: "plugins/email-channel/README.md",
      description: "Email Channel package ownership and verification notes.",
    },
  ],
  compatibilityLinks: [],
} as const;

export { emailChannelManifest };
export * from "./provider-contract";
