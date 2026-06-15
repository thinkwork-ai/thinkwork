import { describe, expect, it } from "vitest";

import {
  PluginPackageError,
  defineFirstPartyPluginPackage,
} from "../plugin-package";
import { firstPartyPluginPackages, planePluginPackage } from "../plugins";

describe("first-party plugin packages", () => {
  it("registers Plane from the root plugin package boundary", () => {
    expect(firstPartyPluginPackages.map((entry) => entry.packageKey)).toEqual([
      "company-brain",
      "lastmile",
      "plane",
      "twenty",
    ]);
    expect(planePluginPackage.sourceRoot).toBe("plugins/plane");
    expect(planePluginPackage.manifest.pluginKey).toBe("plane");
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
});
