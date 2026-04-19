/**
 * mobileWikiSearch — wiki pages ranked by Hindsight recall order.
 *
 * Hindsight already does the hard part (BM25 + vector + rerank). Our job is
 * to reverse-join its ranked memory hits to the compiled pages that cite
 * them and preserve that rank order — NOT to re-score with a second engine.
 *
 * Scoring: reciprocal rank over Hindsight's returned position.
 *   - A page's primary score is the BEST (lowest-rank) Hindsight hit that
 *     cites it.
 *   - Tiebreaker is the count of distinct Hindsight hits citing the page.
 *   - We intentionally do NOT sum recall-derived scores, because Hindsight
 *     returns no score field (the adapter synthesizes `1 - idx*0.05`), and
 *     summing penalizes focused pages against "hub" pages with many
 *     citations regardless of their position.
 *
 * v1 is strictly agent-scoped: every candidate page is owned by `agentId`.
 */

import { and, eq, inArray } from "drizzle-orm";
import {
	wikiPageSections,
	wikiPages,
	wikiSectionSources,
} from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db, agents } from "../../utils.js";
import { getMemoryServices } from "../../../lib/memory/index.js";
import { toGraphQLPage } from "../wiki/mappers.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
// Ask Hindsight for more than we'll return — many hits collapse to the
// same page (or cite no page at all), but we still want enough depth to
// discover lower-ranked pages past the duplicates.
const RECALL_OVERFETCH = 5;
const RECALL_MAX = 200;

export const mobileWikiSearch = async (
	_parent: unknown,
	args: { agentId: string; query: string; limit?: number },
	ctx: GraphQLContext,
) => {
	const { agentId, query, limit = DEFAULT_LIMIT } = args;
	const trimmed = (query || "").trim();
	if (!trimmed) return [];
	if (!ctx.auth.tenantId) throw new Error("Tenant context required");

	const [agent] = await db
		.select({ id: agents.id, tenant_id: agents.tenant_id, slug: agents.slug })
		.from(agents)
		.where(eq(agents.id, agentId));
	if (!agent || agent.tenant_id !== ctx.auth.tenantId) {
		throw new Error("Agent not found or access denied");
	}

	const tenantId = ctx.auth.tenantId;
	const ownerId = agent.id as string;
	const cappedLimit = Math.max(1, Math.min(limit, MAX_LIMIT));
	const recallLimit = Math.min(cappedLimit * RECALL_OVERFETCH, RECALL_MAX);

	const { recall } = getMemoryServices();
	const hits = await recall.recall({
		tenantId,
		ownerType: "agent",
		ownerId,
		query: trimmed,
		limit: recallLimit,
	});

	if (hits.length === 0) {
		console.log(
			`[mobileWikiSearch] agent=${agent.slug ?? agent.id} query=${JSON.stringify(trimmed)} hits=0 pages=0`,
		);
		return [];
	}

	// memory id → first position Hindsight returned it. Rank 0 is best.
	const memoryRank = new Map<string, number>();
	hits.forEach((hit, idx) => {
		const id = hit.record.id;
		if (!id || typeof id !== "string") return;
		if (!memoryRank.has(id)) memoryRank.set(id, idx);
	});
	const memoryIds = Array.from(memoryRank.keys());

	// Reverse-join: which pages cite any of the recalled memories?
	const sourceRows = await db
		.select({
			source_ref: wikiSectionSources.source_ref,
			page_id: wikiPageSections.page_id,
		})
		.from(wikiSectionSources)
		.innerJoin(
			wikiPageSections,
			eq(wikiPageSections.id, wikiSectionSources.section_id),
		)
		.where(
			and(
				eq(wikiSectionSources.source_kind, "memory_unit"),
				inArray(wikiSectionSources.source_ref, memoryIds),
			),
		);

	if (sourceRows.length === 0) {
		console.log(
			`[mobileWikiSearch] agent=${agent.slug ?? agent.id} query=${JSON.stringify(trimmed)} hits=${hits.length} pages=0`,
		);
		return [];
	}

	// Aggregate per page. Deduplicate (page, memory) pairs so a memory
	// cited by multiple sections of the same page only counts once.
	type Agg = {
		bestRank: number;
		memoryIds: string[];
		memorySet: Set<string>;
	};
	const byPage = new Map<string, Agg>();
	for (const row of sourceRows) {
		const memId = row.source_ref as string;
		const rank = memoryRank.get(memId);
		if (rank === undefined) continue;
		const pageId = row.page_id as string;
		const agg = byPage.get(pageId);
		if (!agg) {
			byPage.set(pageId, {
				bestRank: rank,
				memoryIds: [memId],
				memorySet: new Set([memId]),
			});
			continue;
		}
		if (agg.memorySet.has(memId)) continue;
		agg.memorySet.add(memId);
		agg.memoryIds.push(memId);
		if (rank < agg.bestRank) agg.bestRank = rank;
	}

	const pageIds = Array.from(byPage.keys());
	const pageRows = await db
		.select()
		.from(wikiPages)
		.where(
			and(
				inArray(wikiPages.id, pageIds),
				eq(wikiPages.status, "active"),
				eq(wikiPages.owner_id, ownerId),
				eq(wikiPages.tenant_id, tenantId),
			),
		);

	const ranked = pageRows
		.map((row) => {
			const agg = byPage.get(row.id as string)!;
			// Reciprocal-rank score for surfacing: higher is better.
			const rrfScore = 1 / (agg.bestRank + 60);
			const sortedMemoryIds = agg.memoryIds.slice().sort((a, b) => {
				const ra = memoryRank.get(a) ?? Number.POSITIVE_INFINITY;
				const rb = memoryRank.get(b) ?? Number.POSITIVE_INFINITY;
				return ra - rb;
			});
			return {
				row,
				score: rrfScore,
				bestRank: agg.bestRank,
				matchCount: agg.memorySet.size,
				matchingMemoryIds: sortedMemoryIds,
				lastCompiled: (row.last_compiled_at as Date | null)?.getTime() ?? 0,
			};
		})
		// Sort by Hindsight rank order first (smaller bestRank = better),
		// then by number of distinct matches, then by recency.
		.sort((a, b) => {
			if (a.bestRank !== b.bestRank) return a.bestRank - b.bestRank;
			if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
			return b.lastCompiled - a.lastCompiled;
		})
		.slice(0, cappedLimit);

	console.log(
		`[mobileWikiSearch] agent=${agent.slug ?? agent.id} query=${JSON.stringify(trimmed)} hits=${hits.length} pages=${ranked.length}`,
	);

	return ranked.map((r) => ({
		page: toGraphQLPage(r.row as any, { sections: [], aliases: [] }),
		score: r.score,
		matchingMemoryIds: r.matchingMemoryIds,
	}));
};
