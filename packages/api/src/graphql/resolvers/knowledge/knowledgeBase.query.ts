import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	knowledgeBases,
	snakeToCamel,
} from "../../utils.js";

export const knowledgeBase = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db.select().from(knowledgeBases).where(eq(knowledgeBases.id, args.id));
	return row ? snakeToCamel(row) : null;
};
