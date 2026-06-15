import { validatePluginManifest, type PluginManifest } from "../../contracts";
import { twentyManifest as rawTwentyManifest } from "@thinkwork/plugin-twenty/manifest";

export const twentyManifest: PluginManifest =
  validatePluginManifest(rawTwentyManifest);
