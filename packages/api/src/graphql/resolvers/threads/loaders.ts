import DataLoader from "dataloader";
import { inArray, sql, and, eq, gt } from "drizzle-orm";
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
	 *
	 * Tenant safety: both probes query `thread_turns` by `thread_id` only,
	 * with no `tenant_id` predicate. Callers MUST have tenant-scoped the
	 * parent Thread row before this loader resolves — i.e. only invoke
	 * via a field resolver on an already-authorized Thread object (the
	 * existing pattern on `thread(id)` / `threads(tenantId:)` /
	 * `threadsPaged`). Do not call `.load(threadId)` on an unvalidated
	 * external ID; the loader does not self-protect.
	 */
	threadLifecycleStatus: new DataLoader<string, ThreadLifecycleStatus>(async (threadIds) => {
		const ids = [...threadIds];
		const now = new Date();
		const freshCutoff = new Date(now.getTime() - QUEUED_FRESHNESS_MS);

		// Early return when the batch is empty. DataLoader should never
		// invoke us with zero keys, but direct test callers can — and
		// Drizzle's inArray([]) behavior is driver-dependent.
		if (ids.length === 0) return [];

		// Probe 1: fresh active turns (queued | running). Filter to
		// kind='agent_turn' so system_event rows (escalate/delegate, written
		// with status='succeeded' in U2) never surface as active.
		const activeRows = await db
			.select({ threadId: threadTurns.thread_id })
			.from(threadTurns)
			.where(and(
				inArray(threadTurns.thread_id, ids),
				eq(threadTurns.kind, "agent_turn"),
				inArray(threadTurns.status, ["queued", "running"]),
				gt(threadTurns.created_at, freshCutoff),
			));
		const activeSet = new Set<string>();
		for (const row of activeRows) {
			if (row.threadId) activeSet.add(row.threadId);
		}

		// Probe 2: latest turn per thread (DISTINCT ON thread_id). Filter
		// to kind='agent_turn' so system_event rows (escalate/delegate,
		// status='succeeded') don't clobber the lifecycle to COMPLETED
		// immediately after a handoff.
		const latestMap = new Map<string, { status: string; created_at: Date }>();
		const result = await db.execute(sql`
			SELECT DISTINCT ON (thread_id) thread_id, status, created_at
			FROM thread_turns
			WHERE thread_id = ANY(${sql`ARRAY[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}]`})
			  AND kind = 'agent_turn'
			ORDER BY thread_id, created_at DESC
		`);
		for (const row of (result.rows || []) as Array<{
			thread_id: string;
			status: string;
			created_at: Date | string;
		}>) {
			const createdAt = row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
			// Defensive: if the driver returns an unparsable created_at,
			// skip this row rather than feed NaN into ageMs comparisons.
			// The thread falls through to IDLE via the no-rows branch.
			if (Number.isNaN(createdAt.getTime())) {
				console.warn(
					`[threadLifecycleStatus] Skipping row with invalid created_at for thread ${row.thread_id}`,
				);
				continue;
			}
			latestMap.set(row.thread_id, {
				status: row.status,
				created_at: createdAt,
			});
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
