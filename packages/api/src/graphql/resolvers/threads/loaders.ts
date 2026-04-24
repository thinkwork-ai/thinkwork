import DataLoader from "dataloader";
import { inArray, sql, and, eq } from "drizzle-orm";
import { db, messages } from "../../utils.js";

export const createThreadLoaders = () => ({
	threadLastActivityAt: new DataLoader<string, string | null>(async (threadIds) => {
		const rows = await db
			.select({
				threadId: messages.thread_id,
				lastAt: sql<string>`MAX(${messages.created_at})::timestamptz`,
			})
			.from(messages)
			.where(and(
				inArray(messages.thread_id, [...threadIds]),
				eq(messages.role, "assistant"),
			))
			.groupBy(messages.thread_id);
		const map = new Map(rows.map((r) => [r.threadId, new Date(r.lastAt).toISOString()]));
		return threadIds.map((id) => map.get(id) || null);
	}),
});
