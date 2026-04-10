import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	webhooks,
	snakeToCamel,
} from "../../utils.js";

export const webhook = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db
		.select()
		.from(webhooks)
		.where(eq(webhooks.id, args.id));
	return row ? snakeToCamel(row) : null;
};
