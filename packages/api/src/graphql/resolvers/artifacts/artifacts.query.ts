import type { GraphQLContext } from "../../context.js";
import { isNotNull } from "drizzle-orm";
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
	if (args.favoritedOnly === true) {
		conditions.push(isNotNull(artifacts.favorited_at));
	}
	if (args.cursor) conditions.push(lt(artifacts.created_at, new Date(args.cursor)));
	const limit = Math.min(args.limit || 50, 200);
	// favoritedOnly callers (apps/computer sidebar Favorites section) want
	// most-recently-favorited first, not most-recently-created. Other
	// callers keep the existing created_at-desc ordering so list paging
	// stays stable.
	const orderColumn = args.favoritedOnly === true
		? artifacts.favorited_at
		: artifacts.created_at;
	const rows = await db
		.select()
		.from(artifacts)
		.where(and(...conditions))
		.orderBy(desc(orderColumn))
		.limit(limit);
	return rows.map(artifactToCamel);
};
