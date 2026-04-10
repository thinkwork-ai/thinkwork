import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and, desc, gte, lte,
	activityLog,
	snakeToCamel,
} from "../../utils.js";

export const activityLog_ = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const conditions = [eq(activityLog.tenant_id, args.tenantId)];
	if (args.entityType) conditions.push(eq(activityLog.entity_type, args.entityType));
	if (args.entityId) conditions.push(eq(activityLog.entity_id, args.entityId));
	if (args.actorType) conditions.push(eq(activityLog.actor_type, args.actorType));
	if (args.actorId) conditions.push(eq(activityLog.actor_id, args.actorId));
	if (args.action) conditions.push(eq(activityLog.action, args.action));
	if (args.after) conditions.push(gte(activityLog.created_at, new Date(args.after)));
	if (args.before) conditions.push(lte(activityLog.created_at, new Date(args.before)));
	const limit = Math.min(args.limit ?? 50, 200);
	const rows = await db.select().from(activityLog)
		.where(and(...conditions))
		.orderBy(desc(activityLog.created_at))
		.limit(limit);
	return rows.map(snakeToCamel);
};
