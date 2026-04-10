import DataLoader from "dataloader";
import { inArray } from "drizzle-orm";
import { db, knowledgeBases as knowledgeBasesTable, snakeToCamel } from "../../utils.js";

export const createKnowledgeLoaders = () => ({
	knowledgeBase: new DataLoader<string, any>(async (ids) => {
		const rows = await db.select().from(knowledgeBasesTable).where(inArray(knowledgeBasesTable.id, [...ids]));
		const map = new Map(rows.map((r) => [r.id, snakeToCamel(r)]));
		return ids.map((id) => map.get(id) || null);
	}),
});
