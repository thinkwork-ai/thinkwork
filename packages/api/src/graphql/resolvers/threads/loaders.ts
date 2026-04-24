import DataLoader from "dataloader";
import { inArray, sql, and, eq, gt, desc } from "drizzle-orm";
import { db, messages, threadTurns } from "../../utils.js";
import {
	deriveLifecycleStatus,
	QUEUED_FRESHNESS_MS,
	type ThreadLifecycleStatus,
} from "./lifecycle-status.js";

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

	/**
	 * Derive ThreadLifecycleStatus for each thread via two batched probes:
	 *   - active turns (queued/running within QUEUED_FRESHNESS_MS)
	 *   - latest turn per thread (DISTINCT ON)
	 * Then pipes through the pure-function mapping. Per-request.
	 */
	threadLifecycleStatus: new DataLoader<string, ThreadLifecycleStatus>(async (threadIds) => {
		const ids = [...threadIds];
		const now = new Date();
		const freshCutoff = new Date(now.getTime() - QUEUED_FRESHNESS_MS);

		// Probe 1: fresh active turns (queued | running)
		const activeRows = await db
			.select({ threadId: threadTurns.thread_id })
			.from(threadTurns)
			.where(and(
				inArray(threadTurns.thread_id, ids),
				inArray(threadTurns.status, ["queued", "running"]),
				gt(threadTurns.created_at, freshCutoff),
			));
		const activeSet = new Set<string>();
		for (const row of activeRows) {
			if (row.threadId) activeSet.add(row.threadId);
		}

		// Probe 2: latest turn per thread (DISTINCT ON thread_id)
		const latestMap = new Map<string, { status: string; created_at: Date }>();
		if (ids.length > 0) {
			const result = await db.execute(sql`
				SELECT DISTINCT ON (thread_id) thread_id, status, created_at
				FROM thread_turns
				WHERE thread_id = ANY(${sql`ARRAY[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}]`})
				ORDER BY thread_id, created_at DESC
			`);
			for (const row of (result.rows || []) as Array<{
				thread_id: string;
				status: string;
				created_at: Date | string;
			}>) {
				latestMap.set(row.thread_id, {
					status: row.status,
					created_at: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
				});
			}
		}

		return ids.map((id) =>
			deriveLifecycleStatus({
				hasActiveTurn: activeSet.has(id),
				latestTurn: latestMap.get(id) ?? null,
				now,
			}),
		);
	}),
});
