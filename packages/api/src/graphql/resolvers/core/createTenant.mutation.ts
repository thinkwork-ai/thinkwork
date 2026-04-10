import type { GraphQLContext } from "../../context.js";
import {
	db,
	tenants,
	snakeToCamel, generateSlug,
} from "../../utils.js";

export const createTenant = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	const [row] = await db
		.insert(tenants)
		.values({
			name: i.name,
			slug: i.slug ?? generateSlug(),
			plan: i.plan ?? "free",
		})
		.returning();
	return snakeToCamel(row);
};
