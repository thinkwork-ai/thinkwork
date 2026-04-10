import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	threads, threadLabelAssignments,
	snakeToCamel,
} from "../../utils.js";

export const assignThreadLabel = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [thread] = await db
		.select({ tenant_id: threads.tenant_id })
		.from(threads)
		.where(eq(threads.id, args.threadId));
	if (!thread) throw new Error("Thread not found");
	const [row] = await db
		.insert(threadLabelAssignments)
		.values({
			thread_id: args.threadId,
			label_id: args.labelId,
			tenant_id: thread.tenant_id,
		})
		.returning();
	return snakeToCamel(row);
};
