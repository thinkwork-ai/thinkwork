/**
 * wikiBacklinks — list pages that link to the given page.
 *
 * The target page's owner scope drives visibility: caller must be able to
 * read `(target.tenantId, target.ownerId)`. Since v1 never creates cross-
 * agent page links, backlink rows always live inside the same scope as
 * their target.
 */

import { and, eq } from "drizzle-orm";
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

	const rows = await db
		.select()
		.from(wikiPageLinks)
		.innerJoin(wikiPages, eq(wikiPageLinks.from_page_id, wikiPages.id))
		.where(
			and(
				eq(wikiPageLinks.to_page_id, args.pageId),
				eq(wikiPages.status, "active"),
			),
		);

	return rows.map((r) =>
		toGraphQLPage(r.wiki_pages, { sections: [], aliases: [] }),
	);
};
