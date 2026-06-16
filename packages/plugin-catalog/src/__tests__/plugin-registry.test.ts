import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  discoverPluginRegistryEntries,
  expectedPluginRegistry,
} from "../../scripts/generate-plugin-registry";

describe("generated first-party plugin registry", () => {
  it("discovers plugin packages from plugins/* in deterministic order", () => {
    expect(
      discoverPluginRegistryEntries().map((entry) => ({
        packageKey: entry.packageKey,
        packageName: entry.packageName,
        exportName: entry.exportName,
      })),
    ).toEqual([
      {
        packageKey: "company-brain",
        packageName: "@thinkwork/plugin-company-brain",
        exportName: "companyBrainPluginPackage",
      },
      {
        packageKey: "lastmile",
        packageName: "@thinkwork/plugin-lastmile",
        exportName: "lastmilePluginPackage",
      },
      {
        packageKey: "plane",
        packageName: "@thinkwork/plugin-plane",
        exportName: "planePluginPackage",
      },
      {
        packageKey: "twenty",
        packageName: "@thinkwork/plugin-twenty",
        exportName: "twentyPluginPackage",
      },
    ]);
  });

  it("keeps the checked-in generated aggregate fresh", () => {
    const generatedPath = fileURLToPath(
      new URL("../plugins/generated-first-party.ts", import.meta.url),
    );
    expect(readFileSync(generatedPath, "utf8")).toBe(expectedPluginRegistry());
  });
});
