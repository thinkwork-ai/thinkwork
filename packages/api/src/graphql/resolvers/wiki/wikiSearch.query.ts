/**
 * wikiSearch — Postgres FTS + exact-alias lookup over compiled pages in one
 * (tenant, owner) scope.
 *
 * Uses the `search_tsv` generated column on wiki_pages (GIN indexed). Alias
 * hits are OR'd in so users can search by a known alternate name and get
 * an exact match even if the prose doesn't contain the query terms.
 *
 * `plainto_tsquery` handles multi-word input without the caller having to
 * build tsquery syntax; empty queries return []. Results are ranked by
 * ts_rank, with a +1 boost for alias matches so exact-name hits come first.
 */

import { sql } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import { db } from "../../utils.js";
import { assertCanReadWikiScope } from "./auth.js";
import { toGraphQLPage } from "./mappers.js";

interface WikiSearchRow {
	id: string;
	tenant_id: string;
	owner_id: string;
	type: string;
	slug: string;
	title: string;
	summary: string | null;
	body_md: string | null;
	status: string;
	last_compiled_at: Date | null;
	created_at: Date;
	updated_at: Date;
	score: number;
	matched_alias: string | null;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export const wikiSearch = async (
	_parent: unknown,
	args: {
		tenantId: string;
		userId?: string | null;
		ownerId?: string | null;
		query: string;
		limit?: number;
	},
	ctx: GraphQLContext,
) => {
	const { tenantId, userId } = await assertCanReadWikiScope(ctx, args);

	const query = args.query.trim();
	if (query.length === 0) return [];
	const limit = Math.max(1, Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT));

	// Partial prefix match for alias column (lowercased normalized form).
	const aliasNeedle = query.toLowerCase();

	const result = await db.execute(sql`
		WITH alias_hits AS (
			SELECT DISTINCT a.page_id, a.alias
			FROM wiki_page_aliases a
			INNER JOIN wiki_pages p ON p.id = a.page_id
			WHERE p.tenant_id = ${args.tenantId}
			  AND p.owner_id = ${userId}
			  AND p.status = 'active'
			  AND (a.alias = ${aliasNeedle} OR a.alias ILIKE ${`%${aliasNeedle}%`})
		)
		SELECT
			p.id, p.tenant_id, p.owner_id, p.type, p.slug,
			p.title, p.summary, p.body_md, p.status,
			p.last_compiled_at, p.created_at, p.updated_at,
			(
				COALESCE(ts_rank(p.search_tsv, plainto_tsquery('english', ${query})), 0)
				+ CASE WHEN ah.page_id IS NOT NULL THEN 1.0 ELSE 0.0 END
			)::float AS score,
			ah.alias AS matched_alias
		FROM wiki_pages p
		LEFT JOIN alias_hits ah ON ah.page_id = p.id
		WHERE p.tenant_id = ${args.tenantId}
		  AND p.owner_id = ${userId}
		  AND p.status = 'active'
		  AND (
		    p.search_tsv @@ plainto_tsquery('english', ${query})
		    OR ah.page_id IS NOT NULL
		  )
		ORDER BY score DESC, p.last_compiled_at DESC NULLS LAST
		LIMIT ${limit}
	`);

	const rows = ((result as unknown as { rows?: WikiSearchRow[] }).rows ??
		[]) as WikiSearchRow[];
	return rows.map((r) => ({
		page: toGraphQLPage(
			{
				id: r.id,
				tenant_id: r.tenant_id,
				owner_id: r.owner_id,
				type: r.type,
				slug: r.slug,
				title: r.title,
				summary: r.summary,
				body_md: r.body_md,
				status: r.status,
				last_compiled_at: r.last_compiled_at,
				created_at: r.created_at,
				updated_at: r.updated_at,
			},
			{ sections: [], aliases: [] },
		),
		score: r.score,
		matchedAlias: r.matched_alias,
	}));
};
