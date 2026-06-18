import { describe, expect, it } from "vitest";

import {
  validatePluginManifest,
  type EmailChannelCapability,
  type PluginManifest,
} from "@thinkwork/plugin-catalog/contracts";
import { defineFirstPartyPluginPackage } from "@thinkwork/plugin-catalog/plugin-package";

import { sendgridPluginPackage } from "../src";
import { sendgridManifest } from "../src/manifest";
import {
  SENDGRID_EMAIL_CHANNEL_CAPABILITY_KEY,
  SENDGRID_SETTINGS_SURFACE,
  sendGridEmailChannelProviders,
} from "../src/provider-contract";

function emailCapability(
  manifest: PluginManifest = sendgridManifest as PluginManifest,
): EmailChannelCapability {
  const capability = manifest.versions[0].capabilities?.find(
    (candidate) => candidate.type === "email-channel",
  );
  if (capability?.type !== "email-channel") {
    throw new Error(
      "SendGrid manifest is missing its email-channel capability",
    );
  }
  return capability;
}

describe("SendGrid plugin manifest", () => {
  it("validates as a standalone email provider plugin", () => {
    const validated = validatePluginManifest(sendgridManifest);

    expect(validated.pluginKey).toBe("sendgrid");
    expect(validated.displayName).toBe("SendGrid");
    expect(validated.versions[0].requiredOauthScopes).toEqual([]);
    expect(validated.versions[0].components).toEqual([
      {
        type: "ui-surface",
        key: "settings",
        displayName: "SendGrid settings",
        intendedMount: SENDGRID_SETTINGS_SURFACE,
      },
    ]);
  });

  it("declares only the SendGrid provider option", () => {
    expect(sendGridEmailChannelProviders).toEqual([
      {
        key: "sendgrid",
        displayName: "SendGrid",
        recommended: true,
      },
    ]);

    const capability = emailCapability();
    expect(capability).toMatchObject({
      type: "email-channel",
      key: SENDGRID_EMAIL_CHANNEL_CAPABILITY_KEY,
      settingsSurface: SENDGRID_SETTINGS_SURFACE,
    });
    expect(capability.providers).toEqual(sendGridEmailChannelProviders);
  });

  it("defines a first-party package boundary under plugins/sendgrid", () => {
    const defined = defineFirstPartyPluginPackage(sendgridPluginPackage);

    expect(defined.packageKey).toBe("sendgrid");
    expect(defined.sourceRoot).toBe("plugins/sendgrid");
    expect(defined.ownedSources).toContainEqual({
      kind: "manifest",
      path: "plugins/sendgrid/src/manifest.ts",
      description:
        "SendGrid catalog manifest and provider capability contract.",
    });
    expect(defined.compatibilityLinks).toEqual([]);
  });
});
