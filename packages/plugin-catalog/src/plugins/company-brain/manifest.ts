import { validatePluginManifest, type PluginManifest } from "../../contracts";
import { companyBrainManifest as rawCompanyBrainManifest } from "@thinkwork/plugin-company-brain/manifest";

export const companyBrainManifest: PluginManifest = validatePluginManifest(
  rawCompanyBrainManifest,
);
