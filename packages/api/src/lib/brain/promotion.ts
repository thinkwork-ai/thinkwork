import { activityLog } from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../db.js";
import { writeFacetSection, type DbClient } from "./repository.js";
import type { FactCitation, FacetType } from "./facet-types.js";

export async function promoteFacet(
	args: {
		tenantId: string;
		actorId: string;
		pageId: string;
		toFacet: FacetType;
		sectionSlug: string;
		heading: string;
		content: string;
		sources: FactCitation[];
		justification: string;
	},
	db: DbClient = defaultDb,
): Promise<{ sectionId: string }> {
	if (!args.justification.trim()) {
		throw new Error("facet promotion requires a justification");
	}
	const result = await writeFacetSection(
		{
			tenantId: args.tenantId,
			pageId: args.pageId,
			facetType: args.toFacet,
			sectionSlug: args.sectionSlug,
			heading: args.heading,
			content: args.content,
			sources: args.sources,
			allowPromotion: true,
		},
		db,
	);
	await db.insert(activityLog).values({
		tenant_id: args.tenantId,
		actor_type: "user",
		actor_id: args.actorId,
		action: "facet_promotion",
		entity_type: "tenant_entity_page",
		entity_id: args.pageId,
		metadata: {
			toFacet: args.toFacet,
			sourceFacetType: result.sourceFacetType,
			justification: args.justification,
		},
	});
	return { sectionId: result.sectionId };
}
