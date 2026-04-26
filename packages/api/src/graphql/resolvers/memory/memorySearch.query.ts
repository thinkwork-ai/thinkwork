/**
 * memorySearch — semantic search across long-term memory.
 *
 * Reads through the normalized recall service (see
 * `packages/api/src/lib/memory/recall-service.ts`). The active long-term
 * engine is selected once per deployment via `MEMORY_ENGINE`; this
 * resolver maps normalized `RecallResult`s back onto the GraphQL
 * `MemoryRecord`/`MemorySearchResult` shapes the admin UI expects.
 */

import type { GraphQLContext } from "../../context.js";
import { getMemoryServices } from "../../../lib/memory/index.js";
import type { RecallResult } from "../../../lib/memory/index.js";
import { requireMemoryUserScope } from "../core/require-user-scope.js";

type SearchRow = {
	memoryRecordId: string;
	content: { text: string };
	score: number;
	namespace: string;
	strategyId: string;
	strategy: string;
	createdAt: string | null;
	threadId: string | null;
};

export const memorySearch = async (
	_parent: unknown,
	args: {
		tenantId?: string;
		userId?: string;
		assistantId?: string;
		query: string;
		strategy?: string;
		limit?: number;
	},
	ctx: GraphQLContext,
) => {
	const { query, limit = 10 } = args;
	const { tenantId, userId } = await requireMemoryUserScope(ctx, {
		...args,
		allowTenantAdmin: true,
	});

	const { recall: recallService } = getMemoryServices();
	const hits = await recallService.recall({
		tenantId,
		ownerType: "user",
		ownerId: userId,
		query,
		limit,
	});

	const rows = hits.map((h) => toSearchRow(h, `user_${userId}`));
	const sorted = rows.sort((a, b) => b.score - a.score).slice(0, limit);

	return {
		records: sorted,
		totalCount: sorted.length,
	};
};

function toSearchRow(hit: RecallResult, fallbackNamespace: string): SearchRow {
	const meta = (hit.record.metadata || {}) as Record<string, any>;
	const namespace =
		(meta.namespace as string | undefined) ||
		(meta.bankId as string | undefined) ||
		fallbackNamespace;
	const strategyId =
		(meta.factType as string | undefined) ||
		(meta.memoryStrategyId as string | undefined) ||
		hit.record.strategy ||
		"";
	const rawMeta = (meta.raw || {}) as Record<string, any>;
	const threadId: string | null =
		(hit.record.threadId as string | undefined) ||
		(rawMeta.thread_id as string | undefined) ||
		(rawMeta.threadId as string | undefined) ||
		null;
	return {
		memoryRecordId: hit.record.id,
		content: { text: hit.record.content.text },
		score: hit.score,
		namespace,
		strategyId,
		strategy: hit.record.strategy || "semantic",
		createdAt: hit.record.createdAt || null,
		threadId,
	};
}
