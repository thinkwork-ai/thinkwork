/**
 * wikiGraph — agent-scoped graph of compiled wiki pages and their [[...]]
 * links.
 *
 * Returns one round-trip payload shaped like the legacy `memoryGraph`
 * resolver so the admin force-graph component can swap data sources with
 * minimal code churn. Nodes are `wiki_pages` rows; edges are
 * `wiki_page_links` rows filtered to active-page endpoints.
 *
 * `(tenantId, ownerId)` scoping matches the rest of the v1 wiki read
 * surface (see `assertCanReadWikiScope` and
 * `recentWikiPages.query.ts`). Archived pages and links that dangle into
 * archived pages are excluded.
 */
import { sql } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import { db } from "../../utils.js";
import { assertCanReadWikiScope } from "./auth.js";
import { toGraphQLType } from "./mappers.js";

interface WikiGraphNodeRow {
	id: string;
	type: string;
	slug: string;
	title: string;
	edge_count: number;
}

interface WikiGraphEdgeRow {
	source: string;
	target: string;
}

export interface GraphQLWikiGraphNode {
	id: string;
	label: string;
	type: "page";
	entityType: string;
	slug: string;
	strategy: string | null;
	edgeCount: number;
	latestThreadId: string | null;
}

export interface GraphQLWikiGraphEdge {
	source: string;
	target: string;
	label: string;
	weight: number;
}

export interface GraphQLWikiGraph {
	nodes: GraphQLWikiGraphNode[];
	edges: GraphQLWikiGraphEdge[];
}

export const wikiGraph = async (
	_parent: unknown,
	args: { tenantId: string; ownerId: string },
	ctx: GraphQLContext,
): Promise<GraphQLWikiGraph> => {
	await assertCanReadWikiScope(ctx, {
		tenantId: args.tenantId,
		ownerId: args.ownerId,
	});

	// Pages + degree in one query. Degree counts any link row where the page
	// is either source or target, and only over edges both endpoints of
	// which are active pages in the scope — matches the edge query below.
	const pageResult = await db.execute(sql`
		WITH scope_pages AS (
			SELECT id, type, slug, title
			FROM wiki_pages
			WHERE tenant_id = ${args.tenantId}
			  AND owner_id = ${args.ownerId}
			  AND status = 'active'
		),
		scope_links AS (
			SELECT l.from_page_id, l.to_page_id
			FROM wiki_page_links l
			JOIN scope_pages sp1 ON sp1.id = l.from_page_id
			JOIN scope_pages sp2 ON sp2.id = l.to_page_id
		),
		endpoints AS (
			SELECT from_page_id AS page_id FROM scope_links
			UNION ALL
			SELECT to_page_id AS page_id FROM scope_links
		)
		SELECT
			sp.id, sp.type, sp.slug, sp.title,
			COALESCE(ep.edge_count, 0)::int AS edge_count
		FROM scope_pages sp
		LEFT JOIN (
			SELECT page_id, COUNT(*)::int AS edge_count
			FROM endpoints
			GROUP BY page_id
		) ep ON ep.page_id = sp.id
		ORDER BY edge_count DESC, sp.title ASC
	`);

	const pageRows = ((pageResult as unknown as { rows?: WikiGraphNodeRow[] })
		.rows ?? []) as WikiGraphNodeRow[];

	const edgeResult = await db.execute(sql`
		SELECT l.from_page_id AS source, l.to_page_id AS target
		FROM wiki_page_links l
		JOIN wiki_pages p1 ON p1.id = l.from_page_id
		JOIN wiki_pages p2 ON p2.id = l.to_page_id
		WHERE p1.tenant_id = ${args.tenantId}
		  AND p1.owner_id = ${args.ownerId}
		  AND p1.status = 'active'
		  AND p2.tenant_id = ${args.tenantId}
		  AND p2.owner_id = ${args.ownerId}
		  AND p2.status = 'active'
	`);

	const edgeRows = ((edgeResult as unknown as { rows?: WikiGraphEdgeRow[] })
		.rows ?? []) as WikiGraphEdgeRow[];

	const nodes: GraphQLWikiGraphNode[] = pageRows.map((r) => ({
		id: r.id,
		label: r.title,
		type: "page",
		entityType: toGraphQLType(r.type),
		slug: r.slug,
		strategy: null,
		edgeCount: Number(r.edge_count) || 0,
		latestThreadId: null,
	}));

	const edges: GraphQLWikiGraphEdge[] = edgeRows.map((r) => ({
		source: r.source,
		target: r.target,
		label: "references",
		weight: 0.5,
	}));

	return { nodes, edges };
};
