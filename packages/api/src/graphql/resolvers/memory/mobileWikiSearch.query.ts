/**
 * mobileWikiSearch — Hindsight recall → compiled wiki pages, ranked.
 *
 * Pipeline:
 *   1. Resolve the agent and authorize against the caller's tenant.
 *   2. Run the same Hindsight recall that mobileMemorySearch uses. Each hit
 *      has a normalized `score` plus the memory unit id.
 *   3. Reverse-join the memory unit ids through wiki_section_sources to
 *      wiki_page_sections to wiki_pages. Multiple sections can cite the
 *      same memory; multiple memories can cite the same page — so aggregate
 *      per-page and keep distinct matching memory ids.
 *   4. Rank pages by the sum of Hindsight scores across their matching
 *      memories, tie-break on best (max) single-hit score, and finally on
 *      most-recently-compiled.
 *
 * v1 is strictly agent-scoped: every matching page is guaranteed to be
 * owned by `agentId` because the source memories are, and the compile
 * pipeline never writes a source row onto a page owned by another agent.
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
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
// Recall a larger set than we ultimately return, because many hits may
// collapse to the same page (or cite no page at all).
const RECALL_OVERFETCH = 3;
const RECALL_MAX = 150;

export const mobileWikiSearch = async (
	_parent: unknown,
	args: { agentId: string; query: string; limit?: number },
	ctx: GraphQLContext,
) => {
	const { agentId, query, limit = DEFAULT_LIMIT } = args;
	const trimmed = (query || "").trim();
	if (!trimmed) return [];
	const tenantId = ctx.auth.tenantId ?? (await resolveCallerTenantId(ctx));
	if (!tenantId) throw new Error("Tenant context required");

	const [agent] = await db
		.select({ id: agents.id, tenant_id: agents.tenant_id, slug: agents.slug })
		.from(agents)
		.where(eq(agents.id, agentId));
	if (!agent || agent.tenant_id !== tenantId) {
		throw new Error("Agent not found or access denied");
	}

	const cappedLimit = Math.max(1, Math.min(limit, MAX_LIMIT));
	const recallLimit = Math.min(cappedLimit * RECALL_OVERFETCH, RECALL_MAX);

	const { recall } = getMemoryServices();
	const hits = await recall.recall({
		tenantId: tenantId,
		ownerType: "agent",
		ownerId: agent.id as string,
		query: trimmed,
		limit: recallLimit,
	});

	if (hits.length === 0) {
		console.log(
			`[mobileWikiSearch] agent=${agent.slug ?? agent.id} query=${JSON.stringify(trimmed)} hits=0 pages=0`,
		);
		return [];
	}

	// Preserve input rank so matchingMemoryIds stays ordered best-first.
	const memoryScores = new Map<string, number>();
	const memoryRank = new Map<string, number>();
	hits.forEach((hit, idx) => {
		const id = hit.record.id;
		if (!id || typeof id !== "string") return;
		if (!memoryScores.has(id)) {
			memoryScores.set(id, hit.score);
			memoryRank.set(id, idx);
		} else {
			// Same memory unit hit twice (different strategies) — keep max score.
			const prev = memoryScores.get(id) ?? 0;
			if (hit.score > prev) memoryScores.set(id, hit.score);
		}
	});
	const memoryIds = Array.from(memoryScores.keys());

	// Section → source memory rows that match any recalled memory.
	const sourceRows = await db
		.select({
			section_id: wikiSectionSources.section_id,
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

	// Aggregate per page: sum score, max score, distinct matching memory ids
	// (preserving Hindsight rank order).
	type Agg = {
		pageId: string;
		sumScore: number;
		maxScore: number;
		memoryIds: string[];
		memorySet: Set<string>;
		bestRank: number;
	};
	const byPage = new Map<string, Agg>();
	for (const row of sourceRows) {
		const memId = row.source_ref as string;
		const score = memoryScores.get(memId) ?? 0;
		const rank = memoryRank.get(memId) ?? Number.POSITIVE_INFINITY;
		const pageId = row.page_id as string;
		const existing = byPage.get(pageId);
		if (!existing) {
			byPage.set(pageId, {
				pageId,
				sumScore: score,
				maxScore: score,
				memoryIds: [memId],
				memorySet: new Set([memId]),
				bestRank: rank,
			});
			continue;
		}
		if (!existing.memorySet.has(memId)) {
			existing.memorySet.add(memId);
			existing.memoryIds.push(memId);
			existing.sumScore += score;
			if (score > existing.maxScore) existing.maxScore = score;
			if (rank < existing.bestRank) existing.bestRank = rank;
		}
	}

	const pageIds = Array.from(byPage.keys());
	const pageRows = await db
		.select()
		.from(wikiPages)
		.where(
			and(
				inArray(wikiPages.id, pageIds),
				eq(wikiPages.status, "active"),
				eq(wikiPages.owner_id, agent.id as string),
				eq(wikiPages.tenant_id, tenantId),
			),
		);

	const ranked = pageRows
		.map((row) => {
			const agg = byPage.get(row.id as string);
			// Sort matching memory ids by their original Hindsight rank so the
			// client can trust the order as "best-matching first."
			const sortedMemoryIds = (agg?.memoryIds ?? []).slice().sort((a, b) => {
				const ra = memoryRank.get(a) ?? Number.POSITIVE_INFINITY;
				const rb = memoryRank.get(b) ?? Number.POSITIVE_INFINITY;
				return ra - rb;
			});
			return {
				row,
				score: agg?.sumScore ?? 0,
				maxScore: agg?.maxScore ?? 0,
				matchingMemoryIds: sortedMemoryIds,
				lastCompiled: (row.last_compiled_at as Date | null)?.getTime() ?? 0,
			};
		})
		.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			if (b.maxScore !== a.maxScore) return b.maxScore - a.maxScore;
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
