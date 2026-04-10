import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	tenantMembers,
	snakeToCamel,
} from "../../utils.js";

export const updateTenantMember = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	const updates: Record<string, unknown> = { updated_at: new Date() };
	if (i.role !== undefined) updates.role = i.role;
	if (i.status !== undefined) updates.status = i.status;
	const [row] = await db.update(tenantMembers).set(updates).where(eq(tenantMembers.id, args.id)).returning();
	if (!row) throw new Error("Member not found");
	return snakeToCamel(row);
};
