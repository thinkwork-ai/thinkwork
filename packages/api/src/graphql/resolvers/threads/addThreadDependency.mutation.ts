import type { GraphQLContext } from "../../context.js";
import {
	db, eq, sql,
	threads, threadDependencies,
	snakeToCamel,
} from "../../utils.js";

export const addThreadDependency = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const { threadId, blockedByThreadId } = args;

	// Self-reference check
	if (threadId === blockedByThreadId) {
		throw new Error("A thread cannot depend on itself");
	}

	// Verify both threads exist and are in the same tenant
	const [thread] = await db.select({ tenant_id: threads.tenant_id }).from(threads).where(eq(threads.id, threadId));
	if (!thread) throw new Error("Thread not found");
	const [blocker] = await db.select({ tenant_id: threads.tenant_id }).from(threads).where(eq(threads.id, blockedByThreadId));
	if (!blocker) throw new Error("Blocker thread not found");
	if (thread.tenant_id !== blocker.tenant_id) throw new Error("Threads must be in the same tenant");

	// Cycle detection via recursive CTE
	const cycleResult = await db.execute(sql`
		WITH RECURSIVE dep_chain AS (
			SELECT blocked_by_thread_id AS ancestor FROM thread_dependencies WHERE thread_id = ${blockedByThreadId}::uuid
			UNION
			SELECT td.blocked_by_thread_id FROM thread_dependencies td JOIN dep_chain dc ON td.thread_id = dc.ancestor
		)
		SELECT EXISTS (SELECT 1 FROM dep_chain WHERE ancestor = ${threadId}::uuid) AS has_cycle
	`);
	const hasCycle = ((cycleResult.rows || [])[0] as { has_cycle: boolean } | undefined)?.has_cycle;
	if (hasCycle) {
		throw new Error("Adding this dependency would create a cycle");
	}

	const [row] = await db
		.insert(threadDependencies)
		.values({
			tenant_id: thread.tenant_id,
			thread_id: threadId,
			blocked_by_thread_id: blockedByThreadId,
		})
		.returning();
	return snakeToCamel(row);
};
