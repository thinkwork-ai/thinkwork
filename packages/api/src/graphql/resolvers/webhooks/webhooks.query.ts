import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and, desc,
	webhooks,
	snakeToCamel,
} from "../../utils.js";

export const webhooks_ = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const conditions = [eq(webhooks.tenant_id, args.tenantId)];
	if (args.targetType) conditions.push(eq(webhooks.target_type, args.targetType));
	if (args.enabled !== undefined) conditions.push(eq(webhooks.enabled, args.enabled));
	const limit = Math.min(args.limit || 50, 200);
	const rows = await db
		.select()
		.from(webhooks)
		.where(and(...conditions))
		.orderBy(desc(webhooks.created_at))
		.limit(limit);
	return rows.map(snakeToCamel);
};
