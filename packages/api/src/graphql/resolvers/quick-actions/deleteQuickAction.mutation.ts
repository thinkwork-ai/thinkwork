import type { GraphQLContext } from "../../context.js";
import { db, eq, userQuickActions } from "../../utils.js";

export const deleteQuickAction = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const { id } = args as { id: string };
	const userId = ctx.auth.principalId;
	if (!userId) throw new Error("Unauthorized");

	// Verify ownership
	const [existing] = await db.select().from(userQuickActions).where(eq(userQuickActions.id, id));
	if (!existing || existing.user_id !== userId) throw new Error("Quick action not found");

	await db.delete(userQuickActions).where(eq(userQuickActions.id, id));
	return true;
};
