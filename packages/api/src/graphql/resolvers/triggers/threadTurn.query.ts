import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	threadTurns,
	snakeToCamel,
} from "../../utils.js";

export const threadTurn = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db.select().from(threadTurns).where(eq(threadTurns.id, args.id));
	return row ? snakeToCamel(row) : null;
};
