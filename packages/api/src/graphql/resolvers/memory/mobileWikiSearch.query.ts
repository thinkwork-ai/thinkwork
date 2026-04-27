/**
 * mobileWikiSearch — Postgres FTS over compiled wiki pages in one
 * (tenant, user) scope.
 *
 * Ranks compiled pages through the shared wiki FTS helper against the
 * GIN-indexed `search_tsv` generated column on `wiki_pages` (title ||
 * summary || body_md). The helper also applies alias boost and prefix
 * matching for mobile-friendly partial input.
 *
 * History: this resolver previously routed through Hindsight semantic
 * recall + a `wiki_section_sources` reverse-join. That path dominated
 * mobile latency at ~10 seconds per query for what users actually typed
 * (page titles like "Austin", "Dake's Shoppe"). FTS over the compiled
 * corpus is the right tool for that query shape; conceptual recall is
 * deferred until we see a real need for it on this surface.
 *
 * Response shape is preserved for GraphQL wire compatibility with live
 * mobile clients: `{ page, score, matchingMemoryIds }`. The memory-ids
 * field is always [] on this path — pages are matched against their own
 * compiled text, not against source memory units.
 *
 * v1 scope rule: every wiki page is user-scoped. The WHERE clause pins
 * `tenant_id` and `owner_id` so cross-user visibility is impossible.
 */

import type { GraphQLContext } from "../../context.js";
import { requireMemoryUserScope } from "../core/require-user-scope.js";
import { searchWikiForUser } from "../../../lib/wiki/search.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export const mobileWikiSearch = async (
	_parent: unknown,
	args: {
		tenantId?: string;
		userId?: string;
		agentId?: string;
		query: string;
		limit?: number;
	},
	ctx: GraphQLContext,
) => {
	const { query, limit = DEFAULT_LIMIT } = args;
	const trimmed = (query || "").trim();
	if (!trimmed) return [];
	const { tenantId, userId } = await requireMemoryUserScope(ctx, args);

	const ownerId = userId as string;
	const cappedLimit = Math.max(1, Math.min(limit, MAX_LIMIT));

	const rows = await searchWikiForUser({
		tenantId,
		userId: ownerId,
		query: trimmed,
		limit: cappedLimit,
	});

	console.log(
		`[mobileWikiSearch] user=${userId} query=${JSON.stringify(trimmed)} pages=${rows.length}`,
	);

	return rows.map((r) => ({
		page: r.page,
		score: r.score,
		matchingMemoryIds: [] as string[],
	}));
};
