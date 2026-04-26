/**
 * recentWikiPages — newest compiled wiki pages for a given agent.
 *
 * Agent-scoped surface for the mobile Memories tab's empty state so
 * users can see what's landing in their memory before they know what
 * to search for. Uses the same auth shape as mobileWikiSearch: caller
 * must own the user's tenant.
 *
 * Ordered by last_compiled_at DESC (fall back to updated_at when the
 * page has never been compiled — new pages from the compile bootstrap
 * have no last_compiled_at until the first reconcile pass).
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { wikiPages } from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db } from "../../utils.js";
import { toGraphQLPage } from "../wiki/mappers.js";
import { requireMemoryUserScope } from "../core/require-user-scope.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export const recentWikiPages = async (
	_parent: unknown,
	args: { tenantId?: string; userId?: string; agentId?: string; limit?: number },
	ctx: GraphQLContext,
) => {
	const { limit = DEFAULT_LIMIT } = args;
	const { tenantId, userId } = await requireMemoryUserScope(ctx, args);

	const cappedLimit = Math.max(1, Math.min(limit, MAX_LIMIT));

	const rows = await db
		.select()
		.from(wikiPages)
		.where(
			and(
				eq(wikiPages.tenant_id, tenantId),
				eq(wikiPages.owner_id, userId as string),
				eq(wikiPages.status, "active"),
			),
		)
		.orderBy(
			desc(sql`COALESCE(${wikiPages.last_compiled_at}, ${wikiPages.updated_at})`),
		)
		.limit(cappedLimit);

	// recentWikiPages is a listing surface — sections/aliases aren't
	// needed in the mobile card; fetch the single page via
	// `wikiPage(slug)` when the user taps in.
	return rows.map((r) => toGraphQLPage(r, { sections: [], aliases: [] }));
};
