/**
 * Field resolvers for `WikiPage` — the Unit 8 read surfaces (handoff
 * plan item #3). Each field runs per-page on demand, so list screens
 * (`wikiSearch`, `recentWikiPages`) must NOT request them or you'll
 * cause an N+1 fan-out. Detail screens only.
 *
 * Parent-level authorization was enforced when the page was fetched
 * through `wikiPage` / `recentWikiPages` / `wikiSearch`, so field
 * resolvers here trust the parent object and skip re-checking
 * (tenantId, userId). Cross-tenant access cannot reach these resolvers
 * because the parent query would have thrown first.
 */

import {
	findPageById,
	findPromotedFromSection,
	countSourceMemoriesForPage,
	listActiveChildPages,
	listSectionChildPages,
	listSourceMemoryIdsForPage,
} from "../../../lib/wiki/repository.js";
import { toGraphQLPage, type GraphQLWikiPage } from "./mappers.js";

export interface GraphQLWikiPromotedFromSection {
	parentPage: GraphQLWikiPage;
	sectionSlug: string;
	sectionHeading: string;
}

async function sourceMemoryCount(parent: GraphQLWikiPage): Promise<number> {
	return countSourceMemoriesForPage(parent.id);
}

async function sourceMemoryIds(
	parent: GraphQLWikiPage,
	args: { limit?: number | null },
): Promise<string[]> {
	const limit = args.limit ?? 10;
	return listSourceMemoryIdsForPage(parent.id, limit);
}

async function parent(
	parent: GraphQLWikiPage,
): Promise<GraphQLWikiPage | null> {
	if (!parent._parentPageId) return null;
	const row = await findPageById(parent._parentPageId);
	if (!row || row.status !== "active") return null;
	return toGraphQLPage(row, { sections: [], aliases: [] });
}

async function children(parent: GraphQLWikiPage): Promise<GraphQLWikiPage[]> {
	const rows = await listActiveChildPages(parent.id);
	return rows.map((r) => toGraphQLPage(r, { sections: [], aliases: [] }));
}

async function promotedFromSection(
	parent: GraphQLWikiPage,
): Promise<GraphQLWikiPromotedFromSection | null> {
	const hit = await findPromotedFromSection(parent.id);
	if (!hit) return null;
	const parentRow = await findPageById(hit.parentPageId);
	if (!parentRow || parentRow.status !== "active") return null;
	return {
		parentPage: toGraphQLPage(parentRow, { sections: [], aliases: [] }),
		sectionSlug: hit.sectionSlug,
		sectionHeading: hit.sectionHeading,
	};
}

async function sectionChildren(
	parent: GraphQLWikiPage,
	args: { sectionSlug: string },
): Promise<GraphQLWikiPage[]> {
	const rows = await listSectionChildPages({
		pageId: parent.id,
		sectionSlug: args.sectionSlug,
	});
	return rows.map((r) => toGraphQLPage(r, { sections: [], aliases: [] }));
}

export const wikiPageTypeResolvers = {
	sourceMemoryCount,
	sourceMemoryIds,
	parent,
	children,
	promotedFromSection,
	sectionChildren,
};
