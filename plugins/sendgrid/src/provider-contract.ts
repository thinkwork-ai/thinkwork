import type { EmailChannelProviderOption } from "@thinkwork/plugin-catalog/contracts";

export const SENDGRID_EMAIL_CHANNEL_CAPABILITY_KEY =
  "sendgrid-email-provider" as const;
export const SENDGRID_SETTINGS_SURFACE =
  "settings.plugins.email-channel" as const;

export const sendGridEmailChannelProviders = [
  {
    key: "sendgrid",
    displayName: "SendGrid",
    recommended: true,
  },
] satisfies EmailChannelProviderOption[];
