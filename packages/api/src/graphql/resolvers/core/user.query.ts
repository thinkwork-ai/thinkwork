import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	users,
	snakeToCamel,
} from "../../utils.js";

export const user = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db.select().from(users).where(eq(users.id, args.id));
	return row ? snakeToCamel(row) : null;
};
