/**
 * wikiBacklinks — list pages that link to the given page.
 *
 * The target page's owner scope drives visibility: caller must be able to
 * read `(target.tenantId, target.ownerId)`. Since v1 never creates cross-
 * agent page links, backlink rows always live inside the same scope as
 * their target.
 */

import { and, eq, inArray } from "drizzle-orm";
import {
	wikiPages,
	wikiPageLinks,
} from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db } from "../../utils.js";
import { assertCanReadWikiScope } from "./auth.js";
import { toGraphQLPage, type GraphQLWikiPage } from "./mappers.js";

export const wikiBacklinks = async (
	_parent: unknown,
	args: { pageId: string },
	ctx: GraphQLContext,
): Promise<GraphQLWikiPage[]> => {
	const [target] = await db
		.select({
			id: wikiPages.id,
			tenant_id: wikiPages.tenant_id,
			owner_id: wikiPages.owner_id,
		})
		.from(wikiPages)
		.where(eq(wikiPages.id, args.pageId))
		.limit(1);
	if (!target) return [];

	await assertCanReadWikiScope(ctx, {
		tenantId: target.tenant_id,
		ownerId: target.owner_id,
	});

	// Two-step dedup: first pull the set of distinct source page ids
	// pointing at the target (so a parent/child pair with both a
	// `reference` and a `parent_of` row collapses to one id), then fetch
	// the active page rows by id. Sibling resolver `wikiConnectedPages`
	// already uses this shape; `wikiBacklinks` was doing a raw join that
	// surfaced duplicate REFERENCED BY entries + a React key-collision
	// warning on the mobile wiki detail screen.
	const sourceRows = await db
		.selectDistinct({ id: wikiPageLinks.from_page_id })
		.from(wikiPageLinks)
		.where(eq(wikiPageLinks.to_page_id, args.pageId));
	const sourceIds = sourceRows.map((r) => r.id);
	if (sourceIds.length === 0) return [];

	const rows = await db
		.select()
		.from(wikiPages)
		.where(and(inArray(wikiPages.id, sourceIds), eq(wikiPages.status, "active")));

	return rows.map((r) =>
		toGraphQLPage(r, { sections: [], aliases: [] }),
	);
};
