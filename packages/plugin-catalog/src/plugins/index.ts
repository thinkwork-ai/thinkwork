import type { PluginManifest } from "../contracts";
import { lastmileManifest } from "./lastmile/manifest";

/**
 * Every repo-authored manifest published to the catalog. New plugins
 * register here; `scripts/build-catalog.ts` signs this list.
 */
export const allPluginManifests: readonly PluginManifest[] = [lastmileManifest];

export { lastmileManifest };
