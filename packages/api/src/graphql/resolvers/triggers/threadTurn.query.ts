import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	threadTurns,
	snakeToCamel,
} from "../../utils.js";
import { withRuntimeType } from "./threadTurnRuntime.js";

export const threadTurn = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db.select().from(threadTurns).where(eq(threadTurns.id, args.id));
	return row ? withRuntimeType(snakeToCamel(row)) : null;
};
