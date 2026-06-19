import { sendgridManifest } from "./manifest";

export const sendgridPluginPackage = {
  packageKey: "sendgrid",
  sourceRoot: "plugins/sendgrid",
  manifest: sendgridManifest,
  ownedSources: [
    {
      kind: "manifest",
      path: "plugins/sendgrid/src/manifest.ts",
      description:
        "SendGrid Email catalog manifest and provider capability contract.",
    },
    {
      kind: "api",
      path: "plugins/sendgrid/src/provider-contract.ts",
      description:
        "SendGrid Email provider keys and package-local channel contract metadata.",
    },
    {
      kind: "tests",
      path: "plugins/sendgrid/test",
      description:
        "SendGrid Email package-local manifest and provider scope tests.",
    },
    {
      kind: "docs",
      path: "plugins/sendgrid/README.md",
      description: "SendGrid Email package ownership and verification notes.",
    },
  ],
  compatibilityLinks: [],
} as const;

export { sendgridManifest };
export * from "./provider-contract";
