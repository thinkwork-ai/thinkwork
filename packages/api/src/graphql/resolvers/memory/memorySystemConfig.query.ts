/**
 * memorySystemConfig — reports which memory features are available in
 * this deployment. Backed by the normalized memory layer's engine
 * configuration so the admin UI can gate views (e.g. hide the Knowledge
 * Graph toggle when the active engine has no graph inspection).
 *
 * The flags are derived from the active adapter's capabilities.
 */

import { getMemoryServices } from "../../../lib/memory/index.js";

function emptyConfig() {
  return {
    activeEngine: "unavailable",
    managedMemoryEnabled: false,
    userMemoryEnabled: false,
    spaceMemoryEnabled: false,
    companyDistillationEnabled: false,
  };
}

export const memorySystemConfig = async () => {
  try {
    const { config, adapter } = getMemoryServices();
    const capabilities = await adapter.capabilities();
    const userMemoryEnabled =
      config.enabled && capabilities.retain && capabilities.recall;
    const spaceMemoryEnabled =
      userMemoryEnabled && capabilities.spaceMemory === true;
    return {
      activeEngine: config.engine,
      managedMemoryEnabled: config.enabled,
      userMemoryEnabled,
      spaceMemoryEnabled,
      companyDistillationEnabled: false,
    };
  } catch {
    return emptyConfig();
  }
};
