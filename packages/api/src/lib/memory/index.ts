/**
 * ThinkWork memory layer — public entry point.
 *
 * Exposes the normalized recall/inspect/export services bound to the
 * configured engine. Memoized at module level so callers share one adapter
 * instance per Lambda container.
 *
 * Usage:
 *
 *     import { getMemoryServices } from "../../lib/memory/index.js";
 *     const { recall, inspect } = getMemoryServices();
 *     const hits = await recall.recall({ ...ownerRef, query: "..." });
 */

import type { MemoryAdapter } from "./adapter.js";
import { getMemoryConfig, type MemoryConfig } from "./config.js";
import { AgentCoreAdapter } from "./adapters/agentcore-adapter.js";
import { HindsightAdapter } from "./adapters/hindsight-adapter.js";
import { createExportService, type NormalizedExportService } from "./export-service.js";
import { createInspectService, type NormalizedInspectService } from "./inspect-service.js";
import { createRecallService, type NormalizedRecallService } from "./recall-service.js";

export type MemoryServices = {
	config: MemoryConfig;
	adapter: MemoryAdapter;
	recall: NormalizedRecallService;
	inspect: NormalizedInspectService;
	export: NormalizedExportService;
};

let _cached: MemoryServices | null = null;

export function getMemoryServices(): MemoryServices {
	if (_cached) return _cached;
	const config = getMemoryConfig();
	const adapter = buildAdapter(config);
	_cached = {
		config,
		adapter,
		recall: createRecallService(config, adapter),
		inspect: createInspectService(config, adapter),
		export: createExportService(config, adapter),
	};
	return _cached;
}

export function resetMemoryServicesCache(): void {
	_cached = null;
}

function buildAdapter(config: MemoryConfig): MemoryAdapter {
	if (config.engine === "hindsight") {
		if (!config.backends.hindsightEndpoint) {
			throw new Error("Hindsight engine selected but HINDSIGHT_ENDPOINT is empty");
		}
		return new HindsightAdapter({ endpoint: config.backends.hindsightEndpoint });
	}
	if (config.engine === "agentcore") {
		if (!config.backends.agentcoreMemoryId) {
			throw new Error("AgentCore engine selected but AGENTCORE_MEMORY_ID is empty");
		}
		return new AgentCoreAdapter({
			memoryId: config.backends.agentcoreMemoryId,
			region: config.backends.awsRegion,
		});
	}
	throw new Error(`Unknown MEMORY_ENGINE: ${String(config.engine)}`);
}

export * from "./types.js";
export type { MemoryConfig } from "./config.js";
export type { MemoryAdapter } from "./adapter.js";
