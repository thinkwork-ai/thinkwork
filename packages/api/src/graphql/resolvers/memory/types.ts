/**
 * Memory field resolvers — cross-cutting lookups that enrich MemoryRecord
 * results with data from other subsystems.
 *
 * `wikiPages` joins each recalled/searched/inspected memory record back to
 * the Compounding Memory pipeline's `wiki_section_sources` table so the UI
 * can show "this memory is also distilled into page X." One query per
 * MemoryRecord in a result set is fine for typical memorySearch sizes (≤25);
 * swap in a DataLoader when we start bulk-annotating large result sets.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import {
	wikiPageSections,
	wikiPages,
	wikiSectionSources,
} from "@thinkwork/database-pg/schema";
import { db } from "../../utils.js";
import { toGraphQLPage } from "../wiki/mappers.js";

/**
 * Given a MemoryRecord parent (already resolved from Hindsight / AgentCore
 * into the normalized shape), return the set of active wiki pages that cite
 * it as a source. Empty when the record hasn't been compiled, when the
 * tenant doesn't have the wiki enabled, or when the compile pipeline hasn't
 * run since the record was stored.
 *
 * v1 is strictly owner-scoped — by construction every cited page's owner
 * matches the memory's owner, so no extra visibility check is needed here.
 * The caller's access to the MemoryRecord itself was already validated
 * upstream by memoryRecords/memorySearch/etc.
 */
async function resolveWikiPagesForMemory(parent: any): Promise<unknown[]> {
	const memoryRecordId =
		parent?.memoryRecordId ?? parent?.id ?? parent?.memory_unit_id;
	if (!memoryRecordId || typeof memoryRecordId !== "string") return [];

	// Find the distinct page IDs that have at least one section citing this
	// memory unit. The INDEX on (source_kind, source_ref) makes this cheap.
	const sectionRows = await db
		.select({ page_id: wikiPageSections.page_id })
		.from(wikiSectionSources)
		.innerJoin(
			wikiPageSections,
			eq(wikiPageSections.id, wikiSectionSources.section_id),
		)
		.where(
			and(
				eq(wikiSectionSources.source_kind, "memory_unit"),
				eq(wikiSectionSources.source_ref, memoryRecordId),
			),
		);
	const pageIds = Array.from(new Set(sectionRows.map((r) => r.page_id)));
	if (pageIds.length === 0) return [];

	const pageRows = await db
		.select()
		.from(wikiPages)
		.where(and(inArray(wikiPages.id, pageIds), eq(wikiPages.status, "active")))
		.orderBy(sql`${wikiPages.type}, ${wikiPages.slug}`);

	// Empty sections/aliases — this is a preview response. Mobile can fetch
	// the full page via wikiPage(..., type, slug) if the user clicks through.
	return pageRows.map((row) =>
		toGraphQLPage(row as any, { sections: [], aliases: [] }),
	);
}

export const memoryRecordTypeResolvers = {
	wikiPages: resolveWikiPagesForMemory,
};
