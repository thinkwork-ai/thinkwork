import DataLoader from "dataloader";
import { inArray } from "drizzle-orm";
import { db, users, snakeToCamel } from "../../utils.js";

export const createCoreLoaders = () => ({
	user: new DataLoader<string, any>(async (ids) => {
		const rows = await db.select().from(users).where(inArray(users.id, [...ids]));
		const map = new Map(rows.map((r) => [r.id, snakeToCamel(r)]));
		return ids.map((id) => map.get(id) || null);
	}),
});
