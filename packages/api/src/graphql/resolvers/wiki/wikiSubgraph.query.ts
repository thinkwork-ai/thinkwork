/**
 * wikiSubgraph — agent-scoped k-hop neighborhood around a focal page.
 *
 * Powers the mobile force-graph viewer's focal+expand interaction model:
 * given a focal page, return every page reachable within `depth` hops
 * plus the links connecting them. Single round-trip.
 *
 * Scoping mirrors the rest of the v1 wiki read surface: every read is
 * `(tenantId, ownerId)` scoped (see `assertCanReadWikiScope`). Because
 * every wiki page has a non-null `owner_id` (single-agent scope per the
 * v1 scoping doc), the agent filter IS the owner filter — no separate
 * `primary_agent_ids` column needed.
 *
 * Depth clamps to [0, 2]. The 500-node cap returns top-500 by
 * `(degree DESC, last_compiled_at DESC NULLS LAST)` with the focal
 * page always first; truncation surfaces via `truncatedNodeCount` and
 * `hasMore[focalPageId] = true`. Per-node hasMore is a Unit 6 concern.
 *
 * Temporal columns (`first_seen_at`, `last_seen_at`, `is_current`) land
 * in Unit 5; this resolver returns null for those edge fields today and
 * accepts but ignores `atTime` as a forward-compat placeholder.
 */
import { sql } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import { db } from "../../utils.js";
import { assertCanReadWikiScope } from "./auth.js";
import { type GraphQLWikiPage, toGraphQLPage } from "./mappers.js";

const MAX_DEPTH = 2;
const NODE_CAP = 500;

export interface GraphQLWikiPageLink {
	id: string;
	fromPageId: string;
	toPageId: string;
	kind: string;
	context: string | null;
	// Temporal — null until Unit 5 lands.
	firstSeenAt: string | null;
	lastSeenAt: string | null;
	isCurrent: boolean | null;
	// Render hint — null in v1 (no occurrence count yet).
	weight: number | null;
}

export interface GraphQLWikiHasMoreEntry {
	pageId: string;
	hasMore: boolean;
}

export interface GraphQLWikiSubgraph {
	focalPageId: string;
	depth: number;
	atTime: string;
	nodes: GraphQLWikiPage[];
	edges: GraphQLWikiPageLink[];
	hasMore: GraphQLWikiHasMoreEntry[];
	truncatedNodeCount: number;
}

interface RankedPageRow {
	id: string;
	tenant_id: string;
	owner_id: string;
	type: string;
	slug: string;
	title: string;
	summary: string | null;
	body_md: string | null;
	status: string;
	last_compiled_at: Date | string | null;
	created_at: Date | string;
	updated_at: Date | string;
	scope_total_count: number;
}

interface EdgeRow {
	id: string;
	from_page_id: string;
	to_page_id: string;
	kind: string;
	context: string | null;
}

export const wikiSubgraph = async (
	_parent: unknown,
	args: {
		tenantId: string;
		ownerId: string;
		focalPageId: string;
		depth?: number | null;
		atTime?: string | null;
		pageType?: string | null;
	},
	ctx: GraphQLContext,
): Promise<GraphQLWikiSubgraph> => {
	await assertCanReadWikiScope(ctx, {
		tenantId: args.tenantId,
		ownerId: args.ownerId,
	});

	const depth = Math.min(Math.max(args.depth ?? 1, 0), MAX_DEPTH);
	const atTime = args.atTime ?? new Date().toISOString();
	const pageTypeDb = args.pageType ? args.pageType.toLowerCase() : null;

	// One query: recursive expansion → degree ranking within scope → cap to NODE_CAP.
	// Returns capped page rows + the un-capped scope size (so we know how many got truncated).
	const pageResult = await db.execute(sql`
		WITH RECURSIVE expand(id, depth) AS (
			SELECT p.id, 0
			FROM wiki_pages p
			WHERE p.id = ${args.focalPageId}
			  AND p.tenant_id = ${args.tenantId}
			  AND p.owner_id = ${args.ownerId}
			  AND p.status = 'active'
			UNION
			SELECT p.id, e.depth + 1
			FROM expand e
			JOIN wiki_page_links l ON l.from_page_id = e.id OR l.to_page_id = e.id
			JOIN wiki_pages p ON p.id = (
				CASE WHEN l.from_page_id = e.id THEN l.to_page_id ELSE l.from_page_id END
			)
			WHERE e.depth < ${depth}
			  AND p.tenant_id = ${args.tenantId}
			  AND p.owner_id = ${args.ownerId}
			  AND p.status = 'active'
		),
		expanded_ids AS (SELECT DISTINCT id FROM expand),
		typed_ids AS (
			SELECT ei.id
			FROM expanded_ids ei
			JOIN wiki_pages p ON p.id = ei.id
			WHERE ${pageTypeDb}::text IS NULL
			   OR p.id = ${args.focalPageId}
			   OR p.type = ${pageTypeDb}
		),
		degrees AS (
			SELECT page_id, COUNT(*)::int AS degree
			FROM (
				SELECT from_page_id AS page_id FROM wiki_page_links
				WHERE from_page_id IN (SELECT id FROM typed_ids)
				  AND to_page_id IN (SELECT id FROM typed_ids)
				UNION ALL
				SELECT to_page_id AS page_id FROM wiki_page_links
				WHERE from_page_id IN (SELECT id FROM typed_ids)
				  AND to_page_id IN (SELECT id FROM typed_ids)
			) d
			GROUP BY page_id
		),
		total AS (SELECT COUNT(*)::int AS n FROM typed_ids)
		SELECT
			p.id, p.tenant_id, p.owner_id, p.type, p.slug, p.title, p.summary,
			p.body_md, p.status, p.last_compiled_at, p.created_at, p.updated_at,
			(SELECT n FROM total) AS scope_total_count
		FROM wiki_pages p
		LEFT JOIN degrees d ON d.page_id = p.id
		WHERE p.id IN (SELECT id FROM typed_ids)
		ORDER BY
			CASE WHEN p.id = ${args.focalPageId} THEN 0 ELSE 1 END,
			COALESCE(d.degree, 0) DESC,
			p.last_compiled_at DESC NULLS LAST
		LIMIT ${NODE_CAP}
	`);

	const pageRows =
		(pageResult as unknown as { rows?: RankedPageRow[] }).rows ?? [];

	if (pageRows.length === 0) {
		return {
			focalPageId: args.focalPageId,
			depth,
			atTime,
			nodes: [],
			edges: [],
			hasMore: [],
			truncatedNodeCount: 0,
		};
	}

	const totalCount = pageRows[0]?.scope_total_count ?? pageRows.length;
	const truncatedNodeCount = Math.max(0, totalCount - pageRows.length);
	const includedIds = pageRows.map((r) => r.id);

	// Edges entirely within the included set. Bind each ID explicitly via
	// sql.join — drizzle's `${jsArray}` template doesn't reliably serialize
	// to a Postgres array literal across pg drivers (we hit "malformed array
	// literal" with `ANY(${arr}::uuid[])` on dev).
	const idList = sql.join(
		includedIds.map((id) => sql`${id}::uuid`),
		sql`, `,
	);
	const edgesResult = await db.execute(sql`
		SELECT l.id, l.from_page_id, l.to_page_id, l.kind, l.context
		FROM wiki_page_links l
		WHERE l.from_page_id IN (${idList})
		  AND l.to_page_id IN (${idList})
	`);

	const edgeRows = (edgesResult as unknown as { rows?: EdgeRow[] }).rows ?? [];

	const nodes: GraphQLWikiPage[] = pageRows.map((r) =>
		toGraphQLPage(r, { sections: [], aliases: [] }),
	);

	const edges: GraphQLWikiPageLink[] = edgeRows.map((r) => ({
		id: r.id,
		fromPageId: r.from_page_id,
		toPageId: r.to_page_id,
		kind: r.kind,
		context: r.context,
		firstSeenAt: null,
		lastSeenAt: null,
		isCurrent: null,
		weight: null,
	}));

	const hasMore: GraphQLWikiHasMoreEntry[] =
		truncatedNodeCount > 0
			? [{ pageId: args.focalPageId, hasMore: true }]
			: [];

	return {
		focalPageId: args.focalPageId,
		depth,
		atTime,
		nodes,
		edges,
		hasMore,
		truncatedNodeCount,
	};
};
