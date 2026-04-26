import DataLoader from "dataloader";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
	wikiPageSections,
	wikiPages,
	wikiSectionSources,
} from "@thinkwork/database-pg/schema";
import { db } from "../../utils.js";
import { toGraphQLPage } from "../wiki/mappers.js";

export const createMemoryLoaders = () => ({
	wikiPagesByMemoryRecord: new DataLoader<string, unknown[]>(async (memoryRecordIds) => {
		const ids = [...new Set(memoryRecordIds.filter(Boolean))];
		if (ids.length === 0) return memoryRecordIds.map(() => []);

		const rows = await db
			.select({
				memory_record_id: wikiSectionSources.source_ref,
				page: wikiPages,
			})
			.from(wikiSectionSources)
			.innerJoin(
				wikiPageSections,
				eq(wikiPageSections.id, wikiSectionSources.section_id),
			)
			.innerJoin(wikiPages, eq(wikiPages.id, wikiPageSections.page_id))
			.where(
				and(
					eq(wikiSectionSources.source_kind, "memory_unit"),
					inArray(wikiSectionSources.source_ref, ids),
					eq(wikiPages.status, "active"),
				),
			)
			.orderBy(asc(wikiPages.type), asc(wikiPages.slug));

		const byMemoryId = new Map<string, unknown[]>();
		const seen = new Set<string>();
		for (const row of rows) {
			const key = `${row.memory_record_id}:${row.page.id}`;
			if (seen.has(key)) continue;
			seen.add(key);
			const pages = byMemoryId.get(row.memory_record_id) ?? [];
			pages.push(toGraphQLPage(row.page as any, { sections: [], aliases: [] }));
			byMemoryId.set(row.memory_record_id, pages);
		}

		return memoryRecordIds.map((id) => byMemoryId.get(id) ?? []);
	}),
});
