import type { PluginManifest } from "@thinkwork/plugin-catalog/contracts";

import {
  EMAIL_CHANNEL_CAPABILITY_KEY,
  EMAIL_CHANNEL_SETTINGS_SURFACE,
  emailChannelProviders,
} from "./provider-contract";

export const emailChannelManifest = {
  pluginKey: "email-channel",
  displayName: "Email Channel",
  description:
    "Provider-backed agent and Space email channel with Resend, SendGrid, provider readiness, first-send review, inbound authorization, SES compatibility, and ledger evidence.",
  versions: [
    {
      version: "0.1.0",
      requiredOauthScopes: [],
      capabilities: [
        {
          type: "email-channel",
          key: EMAIL_CHANNEL_CAPABILITY_KEY,
          displayName: "Agent and Space email",
          providers: emailChannelProviders.map(
            ({ key, displayName, recommended, compatibility }) => ({
              key,
              displayName,
              recommended,
              compatibility,
            }),
          ),
          settingsSurface: EMAIL_CHANNEL_SETTINGS_SURFACE,
        },
      ],
      components: [
        {
          type: "ui-surface",
          key: "settings",
          displayName: "Email Channel settings",
          intendedMount: EMAIL_CHANNEL_SETTINGS_SURFACE,
        },
      ],
    },
  ],
} satisfies PluginManifest;
