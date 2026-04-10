import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and, desc, sql,
	threads, threadToCamel,
} from "../../utils.js";

export const threads_query = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const conditions = [eq(threads.tenant_id, args.tenantId)];
	if (args.status) conditions.push(eq(threads.status, args.status.toLowerCase()));
	if (args.priority) conditions.push(eq(threads.priority, args.priority.toLowerCase()));
	if (args.type) conditions.push(eq(threads.type, args.type.toLowerCase()));
	if (args.channel) {
		conditions.push(eq(threads.channel, args.channel.toLowerCase()));
	} else {
		// When no channel specified (Inbox), exclude task-channel threads and child threads
		conditions.push(sql`${threads.channel} != 'task'`);
		conditions.push(sql`${threads.parent_id} IS NULL`);
	}
	if (args.agentId) conditions.push(eq(threads.agent_id, args.agentId));
	if (args.assigneeId) conditions.push(eq(threads.assignee_id, args.assigneeId));
	if (args.parentId) conditions.push(eq(threads.parent_id, args.parentId));
	if (args.search) {
		conditions.push(
			sql`search_vector @@ plainto_tsquery('english', ${args.search})`,
		);
	}
	const limit = Math.min(args.limit || 200, 500);
	const rows = await db
		.select()
		.from(threads)
		.where(and(...conditions))
		.orderBy(desc(threads.created_at))
		.limit(limit);

	return rows.map((r) => threadToCamel(r));
};
