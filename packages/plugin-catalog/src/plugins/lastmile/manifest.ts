import { validatePluginManifest, type PluginManifest } from "../../contracts";
import { lastmileManifest as rawLastmileManifest } from "@thinkwork/plugin-lastmile/manifest";

export const lastmileManifest: PluginManifest =
  validatePluginManifest(rawLastmileManifest);
