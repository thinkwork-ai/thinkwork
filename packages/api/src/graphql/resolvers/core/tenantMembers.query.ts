import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	tenantMembers,
	snakeToCamel,
} from "../../utils.js";

export const tenantMembers_ = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const rows = await db.select().from(tenantMembers).where(eq(tenantMembers.tenant_id, args.tenantId));
	return Promise.all(rows.map(async (r) => {
		const isUser = r.principal_type.toLowerCase() === "user";
		const isAgent = r.principal_type.toLowerCase() === "agent";
		const [user, agent] = await Promise.all([
			isUser ? ctx.loaders.user.load(r.principal_id) : Promise.resolve(null),
			isAgent ? ctx.loaders.agent.load(r.principal_id) : Promise.resolve(null),
		]);
		return {
			...snakeToCamel(r),
			user: user ?? null,
			agent: agent ?? null,
		};
	}));
};
