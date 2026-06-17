import { describe, expect, it } from "vitest";

import {
  PluginPackageError,
  defineFirstPartyPluginPackage,
} from "../plugin-package";
import {
  allPluginManifests,
  firstPartyPluginPackages,
  planePluginPackage,
} from "../registry";

describe("first-party plugin packages", () => {
  it("registers Plane from the root plugin package boundary", () => {
    expect(firstPartyPluginPackages.map((entry) => entry.packageKey)).toEqual([
      "company-brain",
      "email-channel",
      "lastmile",
      "plane",
      "twenty",
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
  });

  it("publishes every first-party plugin manifest through the catalog aggregate", () => {
    expect(allPluginManifests.map((manifest) => manifest.pluginKey)).toEqual([
      "company-brain",
      "email-channel",
      "lastmile",
      "plane",
      "twenty",
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
