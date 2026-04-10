import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and,
	threadLabelAssignments,
} from "../../utils.js";

export const removeThreadLabel = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db
		.delete(threadLabelAssignments)
		.where(
			and(
				eq(threadLabelAssignments.thread_id, args.threadId),
				eq(threadLabelAssignments.label_id, args.labelId),
			),
		)
		.returning();
	return !!row;
};
