import { describe, expect, it } from "vitest";
import { allPluginManifests } from "@thinkwork/plugin-catalog";

import { assertManagedAppKey } from "./infra.js";

describe("plugin infrastructure adapter registry", () => {
  it("resolves every catalog infrastructure component managed-app key", () => {
    const managedAppKeys = allPluginManifests.flatMap((manifest) =>
      manifest.versions.flatMap((version) =>
        version.components.flatMap((component) =>
          component.type === "infrastructure" ? [component.managedAppKey] : [],
        ),
      ),
    );

    expect(managedAppKeys.length).toBeGreaterThan(0);
    for (const managedAppKey of managedAppKeys) {
      expect(assertManagedAppKey(managedAppKey)).toBe(managedAppKey);
    }
  });
});
