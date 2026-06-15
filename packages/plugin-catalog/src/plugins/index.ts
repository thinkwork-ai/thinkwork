import type { PluginManifest } from "../contracts";
import { defineFirstPartyPluginPackage } from "../plugin-package";
import { companyBrainPluginPackage as rawCompanyBrainPluginPackage } from "@thinkwork/plugin-company-brain";
import { planePluginPackage as rawPlanePluginPackage } from "@thinkwork/plugin-plane";
import { twentyPluginPackage as rawTwentyPluginPackage } from "@thinkwork/plugin-twenty";
import { lastmileManifest } from "./lastmile/manifest";

/**
 * Root `plugins/*` packages that have moved to the package contract.
 * New plugin-specific source should land in this shape rather than under
 * `packages/plugin-catalog/src/plugins`.
 */
export const planePluginPackage = defineFirstPartyPluginPackage(
  rawPlanePluginPackage,
);
export const companyBrainPluginPackage = defineFirstPartyPluginPackage(
  rawCompanyBrainPluginPackage,
);
export const twentyPluginPackage = defineFirstPartyPluginPackage(
  rawTwentyPluginPackage,
);

export const planeManifest = planePluginPackage.manifest;
export const companyBrainManifest = companyBrainPluginPackage.manifest;
export const twentyManifest = twentyPluginPackage.manifest;

export const firstPartyPluginPackages = [
  companyBrainPluginPackage,
  planePluginPackage,
  twentyPluginPackage,
] as const;

/**
 * Temporary migration bridge for manifests that still live in the legacy
 * plugin-catalog tree. THNK-31 migration PRs should remove entries from this
 * list as their owning `plugins/<plugin-key>/` package takes over.
 */
export const legacyPluginManifestsDuringMigration: readonly PluginManifest[] = [
  lastmileManifest,
];

/**
 * Every repo-authored manifest published to the catalog.
 */
export const allPluginManifests: readonly PluginManifest[] = [
  ...firstPartyPluginPackages.map((pluginPackage) => pluginPackage.manifest),
  ...legacyPluginManifestsDuringMigration,
].sort((a, b) => a.pluginKey.localeCompare(b.pluginKey));

export { lastmileManifest };
