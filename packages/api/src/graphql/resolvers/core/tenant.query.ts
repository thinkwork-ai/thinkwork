import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	tenants,
	snakeToCamel,
} from "../../utils.js";

export const tenant = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db.select().from(tenants).where(eq(tenants.id, args.id));
	return row ? snakeToCamel(row) : null;
};
