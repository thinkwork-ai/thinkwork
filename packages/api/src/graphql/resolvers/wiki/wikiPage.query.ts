/**
 * wikiPage — load one compiled page by (tenant, owner, type, slug) with its
 * sections and aliases. Sections come ordered by position; aliases are a
 * flat string array.
 *
 * Scope rule: caller must have read access to the (tenant, owner) pair.
 */

import { and, asc, eq } from "drizzle-orm";
import {
	wikiPages,
	wikiPageSections,
	wikiPageAliases,
} from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db } from "../../utils.js";
import { assertCanReadWikiScope } from "./auth.js";
import { toGraphQLType, toGraphQLPage } from "./mappers.js";

export const wikiPage = async (
	_parent: unknown,
	args: {
		tenantId: string;
		userId?: string | null;
		ownerId?: string | null;
		type: "ENTITY" | "TOPIC" | "DECISION";
		slug: string;
	},
	ctx: GraphQLContext,
) => {
	const { tenantId, userId } = await assertCanReadWikiScope(ctx, args);

	const lowerType = args.type.toLowerCase() as "entity" | "topic" | "decision";

	const [page] = await db
		.select()
		.from(wikiPages)
		.where(
			and(
				eq(wikiPages.tenant_id, args.tenantId),
				eq(wikiPages.owner_id, userId),
				eq(wikiPages.type, lowerType),
				eq(wikiPages.slug, args.slug),
				eq(wikiPages.status, "active"),
			),
		)
		.limit(1);

	if (!page) return null;

	const [sections, aliases] = await Promise.all([
		db
			.select()
			.from(wikiPageSections)
			.where(eq(wikiPageSections.page_id, page.id))
			.orderBy(asc(wikiPageSections.position)),
		db
			.select({ alias: wikiPageAliases.alias })
			.from(wikiPageAliases)
			.where(eq(wikiPageAliases.page_id, page.id)),
	]);

	return toGraphQLPage(page, {
		sections: sections.map((s) => ({
			id: s.id,
			sectionSlug: s.section_slug,
			heading: s.heading,
			bodyMd: s.body_md,
			position: s.position,
			lastSourceAt: s.last_source_at?.toISOString() ?? null,
		})),
		aliases: aliases.map((a) => a.alias),
	});
};

export { toGraphQLType };
