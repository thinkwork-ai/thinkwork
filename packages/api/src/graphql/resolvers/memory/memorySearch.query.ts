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
import { db, eq, agents } from "../../utils.js";
import { getMemoryServices } from "../../../lib/memory/index.js";
import type { RecallResult } from "../../../lib/memory/index.js";

type SearchRow = {
	memoryRecordId: string;
	content: { text: string };
	score: number;
	namespace: string;
	strategyId: string;
	strategy: string;
	createdAt: string | null;
};

export const memorySearch = async (
	_parent: unknown,
	args: { assistantId: string; query: string; strategy?: string; limit?: number },
	ctx: GraphQLContext,
) => {
	const { assistantId, query, limit = 10 } = args;

	const [agent] = await db
		.select({ id: agents.id, slug: agents.slug, tenant_id: agents.tenant_id })
		.from(agents)
		.where(eq(agents.id, assistantId));

	if (!agent || (ctx.auth.tenantId && agent.tenant_id !== ctx.auth.tenantId)) {
		throw new Error("Agent not found or access denied");
	}

	const { recall: recallService } = getMemoryServices();
	const hits = await recallService.recall({
		tenantId: ctx.auth.tenantId || "",
		ownerType: "agent",
		ownerId: agent.id as string,
		query,
		limit,
	});

	const rows = hits.map((h) => toSearchRow(h, (agent.slug as string) || (agent.id as string)));
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
	return {
		memoryRecordId: hit.record.id,
		content: { text: hit.record.content.text },
		score: hit.score,
		namespace,
		strategyId,
		strategy: hit.record.strategy || "semantic",
		createdAt: hit.record.createdAt || null,
	};
}
