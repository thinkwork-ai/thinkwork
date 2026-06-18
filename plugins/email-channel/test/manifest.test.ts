import { describe, expect, it } from "vitest";

import {
  validatePluginManifest,
  type EmailChannelCapability,
  type PluginManifest,
} from "@thinkwork/plugin-catalog/contracts";
import { defineFirstPartyPluginPackage } from "@thinkwork/plugin-catalog/plugin-package";

import { emailChannelPluginPackage } from "../src";
import { emailChannelManifest } from "../src/manifest";
import {
  EMAIL_CHANNEL_CAPABILITY_KEY,
  EMAIL_CHANNEL_SETTINGS_SURFACE,
  emailChannelProviders,
  isEmailChannelProviderKey,
} from "../src/provider-contract";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function emailCapability(
  manifest: PluginManifest = emailChannelManifest as PluginManifest,
): EmailChannelCapability {
  const capability = manifest.versions[0].capabilities?.find(
    (candidate) => candidate.type === "email-channel",
  );
  if (capability?.type !== "email-channel") {
    throw new Error("email manifest is missing its email-channel capability");
  }
  return capability;
}

describe("Email Channel plugin manifest", () => {
  it("validates as an inert provider-channel plugin", () => {
    const validated = validatePluginManifest(emailChannelManifest);

    expect(validated.pluginKey).toBe("email-channel");
    expect(validated.displayName).toBe("Email Channel");
    expect(validated.versions[0].requiredOauthScopes).toEqual([]);
    expect(validated.versions[0].components).toEqual([
      {
        type: "ui-surface",
        key: "settings",
        displayName: "Email Channel settings",
        intendedMount: EMAIL_CHANNEL_SETTINGS_SURFACE,
      },
    ]);
  });

  it("declares Resend, SendGrid, and SES provider options", () => {
    expect(emailChannelProviders.map((provider) => provider.key)).toEqual([
      "resend",
      "sendgrid",
      "ses",
    ]);
    expect(isEmailChannelProviderKey("resend")).toBe(true);
    expect(isEmailChannelProviderKey("sendgrid")).toBe(true);
    expect(isEmailChannelProviderKey("smtp")).toBe(false);

    const capability = emailCapability();
    expect(capability).toMatchObject({
      type: "email-channel",
      key: EMAIL_CHANNEL_CAPABILITY_KEY,
      settingsSurface: EMAIL_CHANNEL_SETTINGS_SURFACE,
    });
    expect(capability.providers).toEqual([
      {
        key: "resend",
        displayName: "Resend",
        recommended: true,
      },
      {
        key: "sendgrid",
        displayName: "SendGrid",
        compatibility: undefined,
        recommended: undefined,
      },
      {
        key: "ses",
        displayName: "Amazon SES",
        compatibility: true,
      },
    ]);
  });

  it.each(["smtp", "postmark", "mailgun"])(
    "rejects deferred provider %s in the v1 channel capability",
    (provider) => {
      const bad = clone(emailChannelManifest) as PluginManifest;
      emailCapability(bad).providers.push({
        key: provider as "resend",
        displayName: provider,
      });

      expect(() => validatePluginManifest(bad)).toThrow(
        /not a supported email-channel provider/,
      );
    },
  );

  it("rejects provider declarations without exactly one recommendation", () => {
    const bad = clone(emailChannelManifest) as PluginManifest;
    for (const provider of emailCapability(bad).providers) {
      provider.recommended = false;
    }

    expect(() => validatePluginManifest(bad)).toThrow(
      /exactly one recommended provider/,
    );
  });

  it("defines a first-party package boundary under plugins/email-channel", () => {
    const defined = defineFirstPartyPluginPackage(emailChannelPluginPackage);

    expect(defined.packageKey).toBe("email-channel");
    expect(defined.sourceRoot).toBe("plugins/email-channel");
    expect(defined.ownedSources).toContainEqual({
      kind: "manifest",
      path: "plugins/email-channel/src/manifest.ts",
      description:
        "Email Channel catalog manifest and provider capability contract.",
    });
    expect(defined.compatibilityLinks).toEqual([]);
  });
});
