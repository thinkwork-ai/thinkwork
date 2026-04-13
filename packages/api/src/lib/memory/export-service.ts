/**
 * Normalized export service.
 *
 * Returns a {@link MemoryExportBundle} for one owner, signed with the
 * active engine and its capabilities. Callers (admin export UI, data
 * portability API) never see raw backend shapes.
 */

import type { MemoryAdapter } from "./adapter.js";
import type { MemoryConfig } from "./config.js";
import type { ExportRequest, MemoryExportBundle } from "./types.js";

export type NormalizedExportService = {
	export(request: ExportRequest): Promise<MemoryExportBundle>;
};

export function createExportService(
	config: MemoryConfig,
	adapter: MemoryAdapter,
): NormalizedExportService {
	return {
		async export(request: ExportRequest): Promise<MemoryExportBundle> {
			if (!config.inspect.exportEnabled) {
				throw new Error("Memory export is disabled in this deployment");
			}
			return adapter.export(request);
		},
	};
}
