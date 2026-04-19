/**
 * mobileWikiSearch — Hindsight recall + Postgres FTS → ranked wiki pages.
 *
 * Hybrid scoring is the key thing to get right here. Two signals converge
 * on one ranked list:
 *
 *   - semantic (Hindsight): for each recalled memory, reverse-join through
 *     wiki_section_sources to the pages that cite it. A page's semantic
 *     contribution is the MAX hit score across its citing memories — NOT
 *     the sum. Summing penalizes focused pages against "hub" pages (e.g. a
 *     CRM sales rep entity cited by 200 memories would always outrank a
 *     focused "Austin, Texas" entity cited by 9, even when only a minority
 *     of the hub's memories actually match the query).
 *
 *   - lexical (Postgres FTS): rank pages directly against their own
 *     search_tsv (title + summary + body), heavily weighting alias and
 *     title hits. For a query like "austin" this floats the page titled
 *     "Austin, Texas" above CRM pages where "Austin" only appears as an
 *     address.
 *
 * Final score = SEMANTIC_WEIGHT * semantic_max + LEXICAL_WEIGHT * fts_rank
 *             + ALIAS_BONUS (if any alias matches exactly)
 *             + TITLE_EXACT_BONUS (if title ILIKE '%query%')
 *
 * A page can surface via EITHER signal — FTS-only matches (no recalled
 * memory cites them) still appear in the result set.
 *
 * v1 is strictly agent-scoped: every candidate page is owned by `agentId`.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
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
// Recall wider than we return — many hits collapse to the same page (or
// cite no page at all).
const RECALL_OVERFETCH = 3;
const RECALL_MAX = 150;
// Candidate set for FTS: we fetch a wider page pool than the final limit,
// then blend + trim. Larger than cappedLimit so Hindsight-only matches
// aren't crowded out by lexical hits.
const FTS_CANDIDATE_LIMIT = 50;

// Scoring weights. Tuned against the "Austin for Marco" case where
// austin-texas (9 sources) was being beaten by CRM hub pages (200 sources).
const SEMANTIC_WEIGHT = 1.0;
const LEXICAL_WEIGHT = 2.0;
const ALIAS_EXACT_BONUS = 1.5;
const TITLE_EXACT_BONUS = 1.0;

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

	const cappedLimit = Math.max(1, Math.min(limit, MAX_LIMIT));
	const recallLimit = Math.min(cappedLimit * RECALL_OVERFETCH, RECALL_MAX);
	const tenantId = ctx.auth.tenantId;
	const ownerId = agent.id as string;

	// Fan out the two lookups in parallel: semantic recall against Hindsight,
	// lexical FTS against compiled pages. Either can dominate the result.
	const { recall } = getMemoryServices();
	const [hits, ftsRows] = await Promise.all([
		recall
			.recall({
				tenantId,
				ownerType: "agent",
				ownerId,
				query: trimmed,
				limit: recallLimit,
			})
			.catch((err) => {
				console.warn(
					`[mobileWikiSearch] recall failed: ${(err as Error)?.message}`,
				);
				return [] as Awaited<ReturnType<typeof recall.recall>>;
			}),
		fetchFtsCandidates(tenantId, ownerId, trimmed),
	]);

	// Semantic side: memory id → best score + input rank.
	const memoryScores = new Map<string, number>();
	const memoryRank = new Map<string, number>();
	hits.forEach((hit, idx) => {
		const id = hit.record.id;
		if (!id || typeof id !== "string") return;
		const prev = memoryScores.get(id);
		if (prev === undefined || hit.score > prev) {
			memoryScores.set(id, hit.score);
		}
		if (!memoryRank.has(id)) memoryRank.set(id, idx);
	});
	const memoryIds = Array.from(memoryScores.keys());

	// Reverse-join memory ids → pages. Skip the DB round-trip entirely when
	// Hindsight returned nothing.
	const sourceRows =
		memoryIds.length === 0
			? []
			: await db
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

	// Aggregate semantic signal per page: max score, distinct matching
	// memory ids preserved in Hindsight rank order.
	type SemanticAgg = {
		maxScore: number;
		matchCount: number;
		memoryIds: string[];
		memorySet: Set<string>;
	};
	const semanticByPage = new Map<string, SemanticAgg>();
	for (const row of sourceRows) {
		const memId = row.source_ref as string;
		const score = memoryScores.get(memId) ?? 0;
		const pageId = row.page_id as string;
		const agg = semanticByPage.get(pageId);
		if (!agg) {
			semanticByPage.set(pageId, {
				maxScore: score,
				matchCount: 1,
				memoryIds: [memId],
				memorySet: new Set([memId]),
			});
			continue;
		}
		if (agg.memorySet.has(memId)) continue;
		agg.memorySet.add(memId);
		agg.memoryIds.push(memId);
		agg.matchCount += 1;
		if (score > agg.maxScore) agg.maxScore = score;
	}

	// Lexical signal per page comes straight from fetchFtsCandidates.
	const lexicalByPage = new Map<string, FtsRow>(
		ftsRows.map((r) => [r.id, r]),
	);

	// Union of candidates from both signals.
	const candidatePageIds = new Set<string>([
		...semanticByPage.keys(),
		...lexicalByPage.keys(),
	]);
	if (candidatePageIds.size === 0) {
		console.log(
			`[mobileWikiSearch] agent=${agent.slug ?? agent.id} query=${JSON.stringify(trimmed)} hits=${hits.length} pages=0`,
		);
		return [];
	}

	const pageRows = await db
		.select()
		.from(wikiPages)
		.where(
			and(
				inArray(wikiPages.id, Array.from(candidatePageIds)),
				eq(wikiPages.status, "active"),
				eq(wikiPages.owner_id, ownerId),
				eq(wikiPages.tenant_id, tenantId),
			),
		);

	const ranked = pageRows
		.map((row) => {
			const pageId = row.id as string;
			const semantic = semanticByPage.get(pageId);
			const lexical = lexicalByPage.get(pageId);

			const semanticScore = semantic?.maxScore ?? 0;
			const ftsRank = lexical?.rank ?? 0;
			const aliasBonus = lexical?.aliasHit ? ALIAS_EXACT_BONUS : 0;
			const titleBonus = lexical?.titleHit ? TITLE_EXACT_BONUS : 0;

			const finalScore =
				SEMANTIC_WEIGHT * semanticScore +
				LEXICAL_WEIGHT * ftsRank +
				aliasBonus +
				titleBonus;

			const sortedMemoryIds = (semantic?.memoryIds ?? [])
				.slice()
				.sort((a, b) => {
					const ra = memoryRank.get(a) ?? Number.POSITIVE_INFINITY;
					const rb = memoryRank.get(b) ?? Number.POSITIVE_INFINITY;
					return ra - rb;
				});

			return {
				row,
				score: finalScore,
				semanticScore,
				ftsRank,
				matchingMemoryIds: sortedMemoryIds,
				lastCompiled: (row.last_compiled_at as Date | null)?.getTime() ?? 0,
			};
		})
		.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			if (b.semanticScore !== a.semanticScore)
				return b.semanticScore - a.semanticScore;
			if (b.ftsRank !== a.ftsRank) return b.ftsRank - a.ftsRank;
			return b.lastCompiled - a.lastCompiled;
		})
		.slice(0, cappedLimit);

	console.log(
		`[mobileWikiSearch] agent=${agent.slug ?? agent.id} query=${JSON.stringify(trimmed)} hits=${hits.length} semantic_pages=${semanticByPage.size} fts_pages=${lexicalByPage.size} returned=${ranked.length}`,
	);

	return ranked.map((r) => ({
		page: toGraphQLPage(r.row as any, { sections: [], aliases: [] }),
		score: r.score,
		matchingMemoryIds: r.matchingMemoryIds,
	}));
};

interface FtsRow {
	id: string;
	rank: number;
	titleHit: boolean;
	aliasHit: boolean;
}

/**
 * Postgres FTS over wiki_pages.search_tsv + alias lookup, scoped to one
 * (tenant, owner). Returns a candidate pool that's merged with semantic
 * hits upstream. We only return (pageId, rank, titleHit, aliasHit) — the
 * full row is fetched once after the two signals unify their candidate
 * set, to avoid double-fetching.
 */
async function fetchFtsCandidates(
	tenantId: string,
	ownerId: string,
	query: string,
): Promise<FtsRow[]> {
	const needle = query.toLowerCase();
	const like = `%${needle}%`;
	try {
		const result = await db.execute(sql`
			WITH alias_hits AS (
				SELECT DISTINCT a.page_id, MAX(CASE WHEN a.alias = ${needle} THEN 1 ELSE 0 END) AS exact
				FROM wiki_page_aliases a
				INNER JOIN wiki_pages p ON p.id = a.page_id
				WHERE p.tenant_id = ${tenantId}
				  AND p.owner_id = ${ownerId}
				  AND p.status = 'active'
				  AND (a.alias = ${needle} OR a.alias ILIKE ${like})
				GROUP BY a.page_id
			)
			SELECT
				p.id::text AS id,
				COALESCE(ts_rank(p.search_tsv, plainto_tsquery('english', ${query})), 0)::float AS rank,
				(p.title ILIKE ${like}) AS title_hit,
				(ah.page_id IS NOT NULL) AS alias_hit
			FROM wiki_pages p
			LEFT JOIN alias_hits ah ON ah.page_id = p.id
			WHERE p.tenant_id = ${tenantId}
			  AND p.owner_id = ${ownerId}
			  AND p.status = 'active'
			  AND (
			    p.search_tsv @@ plainto_tsquery('english', ${query})
			    OR p.title ILIKE ${like}
			    OR ah.page_id IS NOT NULL
			  )
			ORDER BY rank DESC, p.last_compiled_at DESC NULLS LAST
			LIMIT ${FTS_CANDIDATE_LIMIT}
		`);
		const rows = ((result as unknown as { rows?: any[] }).rows ?? []) as Array<{
			id: string;
			rank: number;
			title_hit: boolean;
			alias_hit: boolean;
		}>;
		return rows.map((r) => ({
			id: r.id,
			rank: Number(r.rank) || 0,
			titleHit: Boolean(r.title_hit),
			aliasHit: Boolean(r.alias_hit),
		}));
	} catch (err) {
		console.warn(
			`[mobileWikiSearch] FTS candidate query failed: ${(err as Error)?.message}`,
		);
		return [];
	}
}
