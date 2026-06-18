import type {
  EmailChannelProviderKey,
  EmailChannelProviderOption,
} from "@thinkwork/plugin-catalog/contracts";

export const EMAIL_CHANNEL_CAPABILITY_KEY = "agent-space-email" as const;
export const EMAIL_CHANNEL_SETTINGS_SURFACE =
  "settings.plugins.email-channel" as const;

export interface EmailChannelProviderDeclaration
  extends EmailChannelProviderOption {
  description: string;
}

export const emailChannelProviders = [
  {
    key: "resend",
    displayName: "Resend",
    recommended: true,
    description:
      "Recommended v1 provider for tenant-owned agent and Space email.",
  },
  {
    key: "ses",
    displayName: "Amazon SES",
    compatibility: true,
    description:
      "AWS-native compatibility and migration provider for existing SES-backed Space email.",
  },
] satisfies EmailChannelProviderDeclaration[];

export function isEmailChannelProviderKey(
  value: string,
): value is EmailChannelProviderKey {
  return emailChannelProviders.some((provider) => provider.key === value);
}
