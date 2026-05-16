/**
 * wikiGraph — user-scoped graph of compiled wiki pages and their [[...]]
 * links.
 *
 * Returns one round-trip payload shaped like the legacy `memoryGraph`
 * resolver so the admin force-graph component can swap data sources with
 * minimal code churn. Nodes are `wiki_pages` rows; edges are
 * `wiki_page_links` rows filtered to active-page endpoints.
 *
 * `(tenantId, userId)` scoping matches the rest of the v1 wiki read
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
	args: { tenantId: string; userId?: string | null; ownerId?: string | null },
	ctx: GraphQLContext,
): Promise<GraphQLWikiGraph> => {
	const { userId } = await assertCanReadWikiScope(ctx, args);

	// Pages + degree in one query. Degree counts distinct connected pages,
	// NOT link rows — wiki.page_links can carry multiple rows per (from,
	// to) pair (reference + parent_of under different `kind` values, see
	// the unique index on wiki.page_links.kind). A page with two rows to
	// the same neighbor should still render as one edge with degree 1.
	const pageResult = await db.execute(sql`
		WITH scope_pages AS (
			SELECT id, type, slug, title
			FROM wiki.pages
			WHERE tenant_id = ${args.tenantId}
			  AND owner_id = ${userId}
			  AND status = 'active'
		),
		scope_links AS (
			SELECT DISTINCT l.from_page_id, l.to_page_id
			FROM wiki.page_links l
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
		SELECT DISTINCT l.from_page_id AS source, l.to_page_id AS target
		FROM wiki.page_links l
		JOIN wiki.pages p1 ON p1.id = l.from_page_id
		JOIN wiki.pages p2 ON p2.id = l.to_page_id
		WHERE p1.tenant_id = ${args.tenantId}
		  AND p1.owner_id = ${userId}
		  AND p1.status = 'active'
		  AND p2.tenant_id = ${args.tenantId}
		  AND p2.owner_id = ${userId}
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
