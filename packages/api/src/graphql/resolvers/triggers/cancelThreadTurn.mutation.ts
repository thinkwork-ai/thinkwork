import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and,
	threadTurns,
	snakeToCamel,
} from "../../utils.js";

export const cancelThreadTurn = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db
		.update(threadTurns)
		.set({ status: "cancelled", finished_at: new Date() })
		.where(and(eq(threadTurns.id, args.id), eq(threadTurns.status, "running")))
		.returning();
	if (!row) throw new Error("Running job run not found");
	return snakeToCamel(row);
};
