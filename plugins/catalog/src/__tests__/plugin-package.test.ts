import { describe, expect, it } from "vitest";

import {
  PluginPackageError,
  defineFirstPartyPluginPackage,
} from "../plugin-package";
import {
  allPluginManifests,
  firstPartyPluginPackages,
  n8nPluginPackage,
  planePluginPackage,
} from "../registry";

describe("first-party plugin packages", () => {
  it("registers Plane and n8n from their root plugin package boundaries", () => {
    expect(firstPartyPluginPackages.map((entry) => entry.packageKey)).toEqual([
      "company-brain",
      "data-integrations",
      "email-channel",
      "lastmile",
      "n8n",
      "plane",
      "sendgrid",
      "twenty",
      "workos-auth",
    ]);
    expect(planePluginPackage.sourceRoot).toBe("plugins/plane");
    expect(planePluginPackage.manifest.pluginKey).toBe("plane");
    expect(planePluginPackage.ownedSources).toContainEqual({
      kind: "manifest",
      path: "plugins/plane/src/manifest.ts",
      description: "Plane catalog manifest and versioned component contract.",
    });
    expect(planePluginPackage.ownedSources).toContainEqual({
      kind: "deployment",
      path: "plugins/plane/src/deployment/managed-app.ts",
      description: "Plane managed-app deployment adapter.",
    });
    expect(planePluginPackage.ownedSources).toContainEqual({
      kind: "terraform",
      path: "plugins/plane/terraform/plane",
      description: "Plane managed-app Terraform module.",
    });
    expect(planePluginPackage.compatibilityLinks).toEqual([]);

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
      "company-brain",
      "data-integrations",
      "lastmile",
      "n8n",
      "plane",
      "email-channel",
      "sendgrid",
      "twenty",
      "workos-auth",
    ]);
  });

  it("rejects package descriptors whose source root does not match the key", () => {
    expect(() =>
      defineFirstPartyPluginPackage({
        ...planePluginPackage,
        sourceRoot: "plugins/not-plane",
      }),
    ).toThrow(PluginPackageError);
  });

  it("rejects package descriptors whose manifest key does not match", () => {
    expect(() =>
      defineFirstPartyPluginPackage({
        ...planePluginPackage,
        packageKey: "not-plane",
      }),
    ).toThrow(PluginPackageError);
  });

  it("rejects owned source descriptors outside the package root", () => {
    expect(() =>
      defineFirstPartyPluginPackage({
        ...planePluginPackage,
        ownedSources: [
          {
            kind: "deployment",
            path: "packages/deployment-runner/src/apps/plane.ts",
            description: "Misplaced Plane deployment adapter.",
          },
        ],
      }),
    ).toThrow(/ownedSources\[0\]\.path must live under plugins\/plane\//);
  });

  it("rejects compatibility links without migration debt documentation", () => {
    expect(() =>
      defineFirstPartyPluginPackage({
        ...planePluginPackage,
        compatibilityLinks: [
          {
            path: "packages/deployment-runner/src/apps/plane.ts",
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
        ...planePluginPackage,
        compatibilityLinks: [
          {
            path: "plugins/plane/src/manifest.ts",
            reason: "Already owned source should not be compatibility debt.",
            removal: "Remove the compatibility link.",
          },
        ],
      }),
    ).toThrow(/should describe legacy source outside plugins\/plane\//);
  });
});
