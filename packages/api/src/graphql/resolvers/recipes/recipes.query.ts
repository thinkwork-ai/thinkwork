import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and, desc, lt,
	recipes,
	recipeToCamel,
} from "../../utils.js";

export const recipes_ = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const conditions = [eq(recipes.tenant_id, args.tenantId)];
	if (args.threadId) conditions.push(eq(recipes.thread_id, args.threadId));
	if (args.agentId) conditions.push(eq(recipes.agent_id, args.agentId));
	if (args.cursor) conditions.push(lt(recipes.created_at, new Date(args.cursor)));
	const limit = Math.min(args.limit || 50, 200);
	const rows = await db
		.select()
		.from(recipes)
		.where(and(...conditions))
		.orderBy(desc(recipes.created_at))
		.limit(limit);
	return rows.map(recipeToCamel);
};
