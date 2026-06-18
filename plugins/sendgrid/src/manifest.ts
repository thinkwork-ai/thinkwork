import type { PluginManifest } from "@thinkwork/plugin-catalog/contracts";

import {
  SENDGRID_EMAIL_CHANNEL_CAPABILITY_KEY,
  SENDGRID_SETTINGS_SURFACE,
  sendGridEmailChannelProviders,
} from "./provider-contract";

export const sendgridManifest = {
  pluginKey: "sendgrid",
  displayName: "SendGrid",
  description:
    "SendGrid email provider for tenant member invitations with authenticated-domain readiness.",
  versions: [
    {
      version: "0.1.0",
      requiredOauthScopes: [],
      capabilities: [
        {
          type: "email-channel",
          key: SENDGRID_EMAIL_CHANNEL_CAPABILITY_KEY,
          displayName: "SendGrid invitation email",
          providers: sendGridEmailChannelProviders,
          settingsSurface: SENDGRID_SETTINGS_SURFACE,
        },
      ],
      components: [
        {
          type: "ui-surface",
          key: "settings",
          displayName: "SendGrid settings",
          intendedMount: SENDGRID_SETTINGS_SURFACE,
        },
      ],
    },
  ],
} satisfies PluginManifest;
