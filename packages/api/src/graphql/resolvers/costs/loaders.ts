import DataLoader from "dataloader";
import { inArray, sql } from "drizzle-orm";
import { db, costEvents } from "../../utils.js";

export const createCostLoaders = () => ({
	costByRequestId: new DataLoader<string, number>(async (requestIds) => {
		const rows = await db
			.select({
				requestId: costEvents.request_id,
				total: sql<string>`COALESCE(SUM(amount_usd), 0)`,
			})
			.from(costEvents)
			.where(inArray(costEvents.request_id, [...requestIds]))
			.groupBy(costEvents.request_id);
		const map = new Map(rows.map((r) => [r.requestId, Number(r.total)]));
		return requestIds.map((id) => map.get(id) || 0);
	}),
});
