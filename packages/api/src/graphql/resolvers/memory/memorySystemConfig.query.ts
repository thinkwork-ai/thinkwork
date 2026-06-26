/**
 * memorySystemConfig — reports which memory features are available in
 * this deployment. Backed by the normalized memory layer's engine
 * configuration so the admin UI can gate views (e.g. hide the Knowledge
 * Graph toggle when the active engine has no graph inspection).
 *
 * The flags are derived from the configured engine. Keep Hindsight separate
 * from "graph inspection": Cognee also exposes graph-backed search, but in the
 * Cognee-first path Hindsight is legacy and should not light up as active.
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
    const { config } = getMemoryServices();
    const cogneeActive = config.enabled && config.engine === "cognee";
    const hindsightActive = config.enabled && config.engine === "hindsight";
    return {
      activeEngine: config.engine,
      managedMemoryEnabled: config.enabled,
      hindsightEnabled: hindsightActive,
      cogneeMemoryEnabled: cogneeActive,
      userMemoryEnabled: cogneeActive,
      spaceMemoryEnabled: cogneeActive,
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
