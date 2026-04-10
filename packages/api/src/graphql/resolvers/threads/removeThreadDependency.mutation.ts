import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and,
	threadDependencies,
} from "../../utils.js";

export const removeThreadDependency = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db
		.delete(threadDependencies)
		.where(
			and(
				eq(threadDependencies.thread_id, args.threadId),
				eq(threadDependencies.blocked_by_thread_id, args.blockedByThreadId),
			),
		)
		.returning();
	return !!row;
};
