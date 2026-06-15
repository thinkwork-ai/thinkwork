import { defineFirstPartyPluginPackage } from "../plugin-package";
import { companyBrainPluginPackage as rawCompanyBrainPluginPackage } from "@thinkwork/plugin-company-brain";
import { lastmilePluginPackage as rawLastmilePluginPackage } from "@thinkwork/plugin-lastmile";
import { planePluginPackage as rawPlanePluginPackage } from "@thinkwork/plugin-plane";
import { twentyPluginPackage as rawTwentyPluginPackage } from "@thinkwork/plugin-twenty";

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
export const lastmilePluginPackage = defineFirstPartyPluginPackage(
  rawLastmilePluginPackage,
);

export const planeManifest = planePluginPackage.manifest;
export const companyBrainManifest = companyBrainPluginPackage.manifest;
export const twentyManifest = twentyPluginPackage.manifest;
export const lastmileManifest = lastmilePluginPackage.manifest;

export const firstPartyPluginPackages = [
  companyBrainPluginPackage,
  lastmilePluginPackage,
  planePluginPackage,
  twentyPluginPackage,
] as const;

/**
 * Every repo-authored manifest published to the catalog.
 */
export const allPluginManifests = firstPartyPluginPackages
  .map((pluginPackage) => pluginPackage.manifest)
  .sort((a, b) => a.pluginKey.localeCompare(b.pluginKey));
