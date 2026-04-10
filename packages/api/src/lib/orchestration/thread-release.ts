/**
 * PRD-09 Batch 2: Shared thread release + unblock cascade logic.
 *
 * Extracted from graphql-resolver.ts so both the GraphQL mutations and
 * the signal processor can release threads through the same path.
 */

import { eq, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
	threads,
	threadDependencies,
	agentWakeupRequests,
} from "@thinkwork/database-pg/schema";

const db = getDb();

/**
 * When a thread reaches done/cancelled, check if any dependent threads are
 * now fully unblocked and fire wakeup requests for them.
 */
export async function checkAndFireUnblockWakeups(
	threadId: string,
	tenantId: string,
): Promise<void> {
	try {
		const dependents = await db
			.select({ thread_id: threadDependencies.thread_id })
			.from(threadDependencies)
			.where(eq(threadDependencies.blocked_by_thread_id, threadId));

		for (const dep of dependents) {
			const unresolvedResult = await db.execute(sql`
				SELECT COUNT(*)::int AS count FROM thread_dependencies td
				JOIN threads t ON t.id = td.blocked_by_thread_id
				WHERE td.thread_id = ${dep.thread_id}::uuid
				  AND t.status NOT IN ('done', 'cancelled')
			`);
			const unresolvedCount =
				((unresolvedResult.rows || [])[0] as { count: number } | undefined)
					?.count || 0;

			if (unresolvedCount === 0) {
				const [thread] = await db
					.select({
						assignee_type: threads.assignee_type,
						assignee_id: threads.assignee_id,
						agent_id: threads.agent_id,
						identifier: threads.identifier,
						number: threads.number,
						status: threads.status,
					})
					.from(threads)
					.where(eq(threads.id, dep.thread_id));

				const agentId =
					thread?.assignee_type === "agent"
						? thread.assignee_id
						: thread?.agent_id;

				if (agentId) {
					// Auto-transition from blocked → todo
					if (thread?.status === "blocked") {
						await db
							.update(threads)
							.set({ status: "todo", updated_at: new Date() })
							.where(eq(threads.id, dep.thread_id));
					}

					await db.insert(agentWakeupRequests).values({
						tenant_id: tenantId,
						agent_id: agentId,
						source: "automation",
						reason: `Thread ${thread?.identifier ?? `#${thread?.number}`} unblocked — all dependencies resolved`,
						trigger_detail: `thread:${dep.thread_id}`,
						payload: { threadId: dep.thread_id },
						requested_by_actor_type: "system",
					});
					console.log(
						`[thread-release] Fired unblock wakeup for thread ${dep.thread_id} → agent ${agentId}`,
					);
				}
			}
		}
	} catch (err) {
		console.error("[thread-release] checkAndFireUnblockWakeups error:", err);
	}
}

/**
 * Release a thread from agent checkout with a new status, update lifecycle
 * timestamps, and trigger unblock cascade for terminal statuses.
 */
export async function releaseThreadWithSignal(
	threadId: string,
	_turnId: string,
	newStatus: string,
	tenantId: string,
): Promise<void> {
	const updates: Record<string, unknown> = {
		checkout_run_id: null,
		status: newStatus,
		updated_at: new Date(),
	};

	if (newStatus === "done") {
		updates.completed_at = new Date();
		updates.closed_at = new Date();
	}
	if (newStatus === "cancelled") {
		updates.cancelled_at = new Date();
	}
	if (newStatus === "in_progress") {
		updates.started_at = new Date();
	}

	await db
		.update(threads)
		.set(updates)
		.where(eq(threads.id, threadId));

	// Fire unblock cascade for terminal statuses
	if (newStatus === "done" || newStatus === "cancelled") {
		await checkAndFireUnblockWakeups(threadId, tenantId);
	}
}
