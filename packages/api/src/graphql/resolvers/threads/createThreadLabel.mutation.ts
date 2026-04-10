import type { GraphQLContext } from "../../context.js";
import {
	db,
	threadLabels,
	snakeToCamel,
} from "../../utils.js";

export const createThreadLabel = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	const [row] = await db
		.insert(threadLabels)
		.values({
			tenant_id: i.tenantId,
			name: i.name,
			color: i.color,
			description: i.description,
		})
		.returning();
	return snakeToCamel(row);
};
