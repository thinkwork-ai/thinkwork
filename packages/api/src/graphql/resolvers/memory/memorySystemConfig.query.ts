/**
 * memorySystemConfig — reports which memory features are available in
 * this deployment. Backed by the normalized memory layer's engine
 * configuration so the admin UI can gate views (e.g. hide the Knowledge
 * Graph toggle when the active engine has no graph inspection).
 *
 * The flags are derived from the active adapter's capabilities. Hindsight is
 * the canonical user and Space memory engine for this pass; Cognee remains a
 * compatibility/diagnostic signal when explicitly selected.
 */

import { getMemoryServices } from "../../../lib/memory/index.js";

function emptyConfig() {
  return {
    activeEngine: "unavailable",
    managedMemoryEnabled: false,
    hindsightEnabled: false,
    cogneeMemoryEnabled: false,
    userMemoryEnabled: false,
    spaceMemoryEnabled: false,
    legacyHindsightAvailable: false,
    companyDistillationEnabled: false,
    wikiProjectionEnabled: false,
  };
}

export const memorySystemConfig = async () => {
  try {
    const { config, adapter } = getMemoryServices();
    const capabilities = await adapter.capabilities();
    const cogneeActive = config.enabled && config.engine === "cognee";
    const hindsightActive = config.enabled && config.engine === "hindsight";
    const userMemoryEnabled =
      config.enabled && capabilities.retain && capabilities.recall;
    const spaceMemoryEnabled =
      userMemoryEnabled && capabilities.spaceMemory === true;
    return {
      activeEngine: config.engine,
      managedMemoryEnabled: config.enabled,
      hindsightEnabled: hindsightActive,
      cogneeMemoryEnabled: cogneeActive,
      userMemoryEnabled,
      spaceMemoryEnabled,
      legacyHindsightAvailable: Boolean(
        config.backends.hindsightEndpoint && !hindsightActive,
      ),
      companyDistillationEnabled: false,
      wikiProjectionEnabled: false,
    };
  } catch {
    return emptyConfig();
  }
};
