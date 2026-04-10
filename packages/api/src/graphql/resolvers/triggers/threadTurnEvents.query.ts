import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and, gt,
	threadTurnEvents,
	snakeToCamel,
} from "../../utils.js";

export const threadTurnEvents_ = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const conditions = [eq(threadTurnEvents.run_id, args.runId)];
	if (args.afterSeq != null) {
		conditions.push(gt(threadTurnEvents.seq, args.afterSeq));
	}
	const limit = Math.min(args.limit || 100, 500);
	const rows = await db
		.select()
		.from(threadTurnEvents)
		.where(and(...conditions))
		.orderBy(threadTurnEvents.seq)
		.limit(limit);
	return rows.map(snakeToCamel);
};
