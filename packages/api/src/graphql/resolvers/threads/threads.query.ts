import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and, desc, sql,
	threads, threadToCamel,
} from "../../utils.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";

export const threads_query = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const conditions = [eq(threads.tenant_id, args.tenantId)];
	if (args.status) conditions.push(eq(threads.status, args.status.toLowerCase()));
	if (args.priority) conditions.push(eq(threads.priority, args.priority.toLowerCase()));
	if (args.type) conditions.push(eq(threads.type, args.type.toLowerCase()));
	if (args.channel) {
		conditions.push(eq(threads.channel, args.channel.toLowerCase()));
	} else {
		// When no channel specified (Inbox), exclude task-channel threads
		conditions.push(sql`${threads.channel} != 'task'`);
	}
	if (args.agentId) conditions.push(eq(threads.agent_id, args.agentId));
	if (args.assigneeId) {
		// Mobile passes user.sub (Cognito) as assigneeId. For Google-OAuth
		// users the DB users.id is a fresh UUID linked by email, so sub !=
		// users.id. When the caller is asking for "threads assigned to me"
		// (passing their own Cognito principalId), rewrite to the caller's
		// DB users.id so threads.assignee_id (which is a users.id FK)
		// actually matches. Non-self filters pass through unchanged.
		let effectiveAssigneeId = args.assigneeId;
		if (
			ctx.auth.authType === "cognito" &&
			args.assigneeId === ctx.auth.principalId
		) {
			const dbId = await resolveCallerUserId(ctx);
			if (dbId) effectiveAssigneeId = dbId;
		}
		conditions.push(eq(threads.assignee_id, effectiveAssigneeId));
	}
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
