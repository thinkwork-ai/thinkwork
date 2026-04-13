/**
 * memorySystemConfig — reports which memory features are available in
 * this deployment. Backed by the normalized memory layer's engine
 * configuration so the admin UI can gate views (e.g. hide the Knowledge
 * Graph toggle when the active engine has no graph inspection).
 *
 * Schema is unchanged (`managedMemoryEnabled`, `hindsightEnabled`). The
 * flags are derived from the configured engine + its capabilities:
 * - managedMemoryEnabled: memory layer is enabled (always true when the
 *   engine is configured correctly).
 * - hindsightEnabled: the active engine exposes entity-graph inspection,
 *   which today is equivalent to "Hindsight is the active engine".
 */

import { getMemoryServices } from "../../../lib/memory/index.js";

export const memorySystemConfig = async () => {
	try {
		const { config, inspect } = getMemoryServices();
		const capabilities = await inspect.capabilities();
		return {
			managedMemoryEnabled: config.enabled,
			hindsightEnabled: capabilities.inspectGraph,
		};
	} catch {
		return {
			managedMemoryEnabled: false,
			hindsightEnabled: false,
		};
	}
};
