import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
        packageKey: "company-data",
        packageName: "@thinkwork/plugin-company-data",
        exportName: "companyDataPluginPackage",
      },
      {
        packageKey: "company-etl",
        packageName: "@thinkwork/plugin-company-etl",
        exportName: "companyEtlPluginPackage",
      },
      {
        packageKey: "email-channel",
        packageName: "@thinkwork/plugin-email-channel",
        exportName: "emailChannelPluginPackage",
      },
      {
        packageKey: "lastmile",
        packageName: "@thinkwork/plugin-lastmile",
        exportName: "lastmilePluginPackage",
      },
      {
        packageKey: "n8n",
        packageName: "@thinkwork/plugin-n8n",
        exportName: "n8nPluginPackage",
      },
      {
        packageKey: "sendgrid",
        packageName: "@thinkwork/plugin-sendgrid",
        exportName: "sendgridPluginPackage",
      },
      {
        packageKey: "twenty",
        packageName: "@thinkwork/plugin-twenty",
        exportName: "twentyPluginPackage",
      },
      {
        packageKey: "workos-auth",
        packageName: "@thinkwork/plugin-workos-auth",
        exportName: "workosAuthPluginPackage",
      },
    ]);
  });

  it("skips packages whose catalog publication is deferred", () => {
    const repoRoot = mkdtempRepo();
    try {
      writePluginPackage(repoRoot, "alpha", "@thinkwork/plugin-alpha");
      writePluginPackage(repoRoot, "n8n", "@thinkwork/plugin-n8n", {
        catalogPublication: "deferred",
      });

      expect(discoverPluginRegistryEntries({ repoRoot })).toEqual([
        {
          packageKey: "alpha",
          packageName: "@thinkwork/plugin-alpha",
          exportName: "alphaPluginPackage",
          manifestExportName: "alphaManifest",
          rawExportName: "rawAlphaPluginPackage",
        },
      ]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("keeps the checked-in generated aggregate fresh", () => {
    const generatedPath = fileURLToPath(
      new URL("../registry/generated-first-party.ts", import.meta.url),
    );
    expect(readFileSync(generatedPath, "utf8")).toBe(expectedPluginRegistry());
  });
});

function mkdtempRepo() {
  const repoRoot = join(
    tmpdir(),
    `thinkwork-plugin-registry-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  mkdirSync(join(repoRoot, "plugins"), { recursive: true });
  return repoRoot;
}

function writePluginPackage(
  repoRoot: string,
  packageKey: string,
  packageName: string,
  thinkworkPlugin?: { catalogPublication?: string },
) {
  const packageRoot = join(repoRoot, "plugins", packageKey);
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(
    join(packageRoot, "package.json"),
    `${JSON.stringify({ name: packageName, thinkworkPlugin }, null, 2)}\n`,
  );
}
