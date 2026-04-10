import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and, desc,
	routines,
	snakeToCamel,
} from "../../utils.js";

export const routines_ = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const conditions = [eq(routines.tenant_id, args.tenantId)];
	if (args.hiveId) conditions.push(eq(routines.hive_id, args.hiveId));
	if (args.agentId) conditions.push(eq(routines.agent_id, args.agentId));
	if (args.status) conditions.push(eq(routines.status, args.status.toLowerCase()));
	const rows = await db
		.select()
		.from(routines)
		.where(and(...conditions))
		.orderBy(desc(routines.created_at));
	return rows.map(snakeToCamel);
};
