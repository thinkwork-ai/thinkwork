import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and, or, isNull, sql,
	threads,
} from "../../utils.js";

// Count of non-archived, non-task, top-level threads in the tenant (optionally
// filtered by agent) that have new activity the caller hasn't read yet. Mirrors
// the default filters in `threads.query.ts` so this count matches what hosts
// render in a chat-style inbox. Activity signal is `last_turn_completed_at`
// (stamped by chat-agent-invoke + wakeup-processor after each agent turn),
// with `updated_at` as fallback for pre-agent threads. Both are on the
// `threads` table so no cross-table join is needed.
export const unreadThreadCount = async (_parent: any, args: any, _ctx: GraphQLContext) => {
	const conditions = [
		eq(threads.tenant_id, args.tenantId),
		isNull(threads.archived_at),
		sql`${threads.channel} != 'task'`,
		isNull(threads.parent_id),
		or(
			isNull(threads.last_read_at),
			sql`COALESCE(${threads.last_turn_completed_at}, ${threads.updated_at}) > ${threads.last_read_at}`,
		),
	];
	if (args.agentId) conditions.push(eq(threads.agent_id, args.agentId));

	const [row] = await db
		.select({ count: sql<number>`COUNT(*)::int` })
		.from(threads)
		.where(and(...conditions));

	return row?.count ?? 0;
};
