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
        "Resend Email catalog manifest and provider capability contract.",
    },
    {
      kind: "api",
      path: "plugins/email-channel/src/provider-contract.ts",
      description:
        "Resend Email provider keys and package-local channel contract metadata.",
    },
    {
      kind: "tests",
      path: "plugins/email-channel/test",
      description:
        "Resend Email package-local manifest and provider scope tests.",
    },
    {
      kind: "docs",
      path: "plugins/email-channel/README.md",
      description: "Resend Email package ownership and verification notes.",
    },
  ],
  compatibilityLinks: [],
} as const;

export { emailChannelManifest };
export * from "./provider-contract";
