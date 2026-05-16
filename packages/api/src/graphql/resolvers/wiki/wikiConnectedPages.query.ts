/**
 * wikiConnectedPages — list pages this page links OUT to.
 *
 * Mirrors `wikiBacklinks` but reads in the opposite direction: given a
 * page, return the pages it references. Mobile and admin surface this
 * as "Connected Pages" alongside "Referenced by" so readers can jump
 * forward through the graph (rollup hubs → their child entities), not
 * just backward.
 *
 * Scope check is driven by the source page (the one whose outbound
 * links we're reading). v1 never crosses scopes, so every target row
 * lives under the same `(tenantId, userId)` anyway; checking source
 * matches the existing backlinks semantics.
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

export const wikiConnectedPages = async (
	_parent: unknown,
	args: { pageId: string },
	ctx: GraphQLContext,
): Promise<GraphQLWikiPage[]> => {
	const [source] = await db
		.select({
			id: wikiPages.id,
			tenant_id: wikiPages.tenant_id,
			owner_id: wikiPages.owner_id,
		})
		.from(wikiPages)
		.where(eq(wikiPages.id, args.pageId))
		.limit(1);
	if (!source) return [];

	await assertCanReadWikiScope(ctx, {
		tenantId: source.tenant_id,
		userId: source.owner_id,
	});

	const rows = await db
		.select()
		.from(wikiPageLinks)
		.innerJoin(wikiPages, eq(wikiPageLinks.to_page_id, wikiPages.id))
		.where(
			and(
				eq(wikiPageLinks.from_page_id, args.pageId),
				eq(wikiPages.status, "active"),
			),
		);

	// Dedup by target page id — the same (from, to) pair may appear with
	// multiple `kind`s (reference + parent_of). We want one row per
	// connected page regardless of link kind.
	const byId = new Map<string, (typeof rows)[number]>();
	for (const r of rows) {
		byId.set(r.pages.id, r);
	}
	return Array.from(byId.values()).map((r) =>
		toGraphQLPage(r.pages, { sections: [], aliases: [] }),
	);
};
