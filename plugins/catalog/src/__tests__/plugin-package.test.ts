import { describe, expect, it } from "vitest";

import {
  PluginPackageError,
  defineFirstPartyPluginPackage,
} from "../plugin-package";
import {
  allPluginManifests,
  firstPartyPluginPackages,
  n8nPluginPackage,
} from "../registry";

describe("first-party plugin packages", () => {
  it("registers n8n from its root plugin package boundary", () => {
    expect(firstPartyPluginPackages.map((entry) => entry.packageKey)).toEqual([
      "company-brain",
      "company-data",
      "company-etl",
      "email-channel",
      "lastmile",
      "n8n",
      "sendgrid",
      "twenty",
      "workos-auth",
    ]);

    expect(n8nPluginPackage.sourceRoot).toBe("plugins/n8n");
    expect(n8nPluginPackage.manifest.pluginKey).toBe("n8n");
    expect(n8nPluginPackage.ownedSources).toContainEqual({
      kind: "manifest",
      path: "plugins/n8n/src/manifest.ts",
      description: "n8n catalog manifest and versioned component contract.",
    });
    expect(n8nPluginPackage.ownedSources).toContainEqual({
      kind: "deployment",
      path: "plugins/n8n/src/deployment",
      description: "n8n managed-app adapter and package image build contract.",
    });
    expect(n8nPluginPackage.ownedSources).toContainEqual({
      kind: "skills",
      path: "plugins/n8n/src/skills",
      description:
        "n8n workflow operator instructions seeded through the plugin catalog.",
    });
    expect(n8nPluginPackage.compatibilityLinks).toEqual([]);
  });

  it("publishes every first-party plugin manifest through the catalog aggregate", () => {
    expect(allPluginManifests.map((manifest) => manifest.pluginKey)).toEqual([
      "lastmile",
      "n8n",
      "email-channel",
      "sendgrid",
      "company-brain",
      "company-data",
      "company-etl",
      "twenty",
      "workos-auth",
    ]);
  });

  it("rejects package descriptors whose source root does not match the key", () => {
    expect(() =>
      defineFirstPartyPluginPackage({
        ...n8nPluginPackage,
        sourceRoot: "plugins/not-n8n",
      }),
    ).toThrow(PluginPackageError);
  });

  it("rejects package descriptors whose manifest key does not match", () => {
    expect(() =>
      defineFirstPartyPluginPackage({
        ...n8nPluginPackage,
        packageKey: "not-n8n",
      }),
    ).toThrow(PluginPackageError);
  });

  it("rejects owned source descriptors outside the package root", () => {
    expect(() =>
      defineFirstPartyPluginPackage({
        ...n8nPluginPackage,
        ownedSources: [
          {
            kind: "deployment",
            path: "packages/deployment-runner/src/apps/n8n.ts",
            description: "Misplaced n8n deployment adapter.",
          },
        ],
      }),
    ).toThrow(/ownedSources\[0\]\.path must live under plugins\/n8n\//);
  });

  it("rejects compatibility links without migration debt documentation", () => {
    expect(() =>
      defineFirstPartyPluginPackage({
        ...n8nPluginPackage,
        compatibilityLinks: [
          {
            path: "packages/deployment-runner/src/apps/n8n.ts",
            reason: "",
            removal: "THNK-31 U3",
          },
        ],
      }),
    ).toThrow(/compatibilityLinks\[0\]\.reason/);
  });

  it("rejects compatibility links that point back inside the package", () => {
    expect(() =>
      defineFirstPartyPluginPackage({
        ...n8nPluginPackage,
        compatibilityLinks: [
          {
            path: "plugins/n8n/src/manifest.ts",
            reason: "Already owned source should not be compatibility debt.",
            removal: "Remove the compatibility link.",
          },
        ],
      }),
    ).toThrow(/should describe legacy source outside plugins\/n8n\//);
  });
});
