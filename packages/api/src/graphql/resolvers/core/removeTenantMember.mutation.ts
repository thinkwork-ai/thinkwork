import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	tenantMembers,
} from "../../utils.js";

export const removeTenantMember = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db.delete(tenantMembers).where(eq(tenantMembers.id, args.id)).returning();
	return !!row;
};
