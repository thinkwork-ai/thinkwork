import DataLoader from "dataloader";
import { inArray, sql, and, eq } from "drizzle-orm";
import { db, threads as threadsTable, messages } from "../../utils.js";

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

	threadChildCount: new DataLoader<string, number>(async (parentIds) => {
		const rows = await db
			.select({
				parentId: threadsTable.parent_id,
				count: sql<number>`COUNT(*)::int`,
			})
			.from(threadsTable)
			.where(inArray(threadsTable.parent_id, [...parentIds]))
			.groupBy(threadsTable.parent_id);
		const map = new Map(rows.map((r) => [r.parentId, r.count]));
		return parentIds.map((id) => map.get(id) || 0);
	}),
});
