import { validatePluginManifest, type PluginManifest } from "../../contracts";
import { planeManifest as rawPlaneManifest } from "@thinkwork/plugin-plane/manifest";

export const planeManifest: PluginManifest =
  validatePluginManifest(rawPlaneManifest);
