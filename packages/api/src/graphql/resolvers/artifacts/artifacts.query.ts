import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and, desc, lt,
	artifacts,
	artifactToCamel,
} from "../../utils.js";

export const artifacts_ = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const conditions = [eq(artifacts.tenant_id, args.tenantId)];
	if (args.threadId) conditions.push(eq(artifacts.thread_id, args.threadId));
	if (args.agentId) conditions.push(eq(artifacts.agent_id, args.agentId));
	if (args.type) conditions.push(eq(artifacts.type, args.type.toLowerCase()));
	if (args.status) conditions.push(eq(artifacts.status, args.status.toLowerCase()));
	if (args.cursor) conditions.push(lt(artifacts.created_at, new Date(args.cursor)));
	const limit = Math.min(args.limit || 50, 200);
	const rows = await db
		.select()
		.from(artifacts)
		.where(and(...conditions))
		.orderBy(desc(artifacts.created_at))
		.limit(limit);
	return rows.map(artifactToCamel);
};
