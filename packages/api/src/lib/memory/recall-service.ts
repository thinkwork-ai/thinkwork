/**
 * Normalized recall service.
 *
 * Single read path for long-term memory. Resolves the configured adapter,
 * applies default limit + token budget, and returns normalized recall
 * results. Never merges multiple engines.
 *
 * Defined per `.prds/memory-implementation-plan.md` §10.
 */

import type { MemoryAdapter } from "./adapter.js";
import type { MemoryConfig } from "./config.js";
import type { RecallRequest, RecallResult } from "./types.js";

const APPROX_CHARS_PER_TOKEN = 4;

export type NormalizedRecallService = {
	recall(request: RecallRequest): Promise<RecallResult[]>;
};

export function createRecallService(
	config: MemoryConfig,
	adapter: MemoryAdapter,
): NormalizedRecallService {
	return {
		async recall(request: RecallRequest): Promise<RecallResult[]> {
			if (!config.enabled) return [];

			const limit = Math.max(1, request.limit ?? config.recall.defaultLimit);
			const tokenBudget = request.tokenBudget ?? config.recall.tokenBudget;

			const raw = await adapter.recall({ ...request, limit });
			const sorted = [...raw].sort((a, b) => b.score - a.score);

			const limited = sorted.slice(0, limit);
			if (!tokenBudget || tokenBudget <= 0) return limited;

			const charBudget = tokenBudget * APPROX_CHARS_PER_TOKEN;
			const out: RecallResult[] = [];
			let used = 0;
			for (const r of limited) {
				const cost = r.record.content.text.length;
				if (out.length > 0 && used + cost > charBudget) break;
				out.push(r);
				used += cost;
			}
			return out;
		},
	};
}
