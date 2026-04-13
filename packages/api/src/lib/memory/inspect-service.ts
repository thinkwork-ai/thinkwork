/**
 * Normalized inspect service.
 *
 * Canonical read path for "list memory records for this owner". Returns
 * ThinkWorkMemoryRecord[] with no backend-native leakage. Callers should
 * gate UI features on the adapter's {@link MemoryCapabilities}.
 */

import type { MemoryAdapter } from "./adapter.js";
import type { MemoryConfig } from "./config.js";
import type {
	InspectRequest,
	MemoryCapabilities,
	ThinkWorkMemoryRecord,
} from "./types.js";

export type NormalizedInspectService = {
	inspect(request: InspectRequest): Promise<ThinkWorkMemoryRecord[]>;
	capabilities(): Promise<MemoryCapabilities>;
};

export function createInspectService(
	config: MemoryConfig,
	adapter: MemoryAdapter,
): NormalizedInspectService {
	return {
		async inspect(request: InspectRequest): Promise<ThinkWorkMemoryRecord[]> {
			if (!config.enabled) return [];
			const records = await adapter.inspect(request);
			return [...records].sort((a, b) =>
				(b.createdAt || "").localeCompare(a.createdAt || ""),
			);
		},
		async capabilities(): Promise<MemoryCapabilities> {
			return adapter.capabilities();
		},
	};
}
