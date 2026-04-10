import type { GraphQLContext } from "../../context.js";
import { db, eq, and, asc, userQuickActions, snakeToCamel } from "../../utils.js";

export const reorderQuickActions = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const { tenantId, orderedIds } = args.input as { tenantId: string; orderedIds: string[] };
	const userId = ctx.auth.principalId;
	if (!userId) throw new Error("Unauthorized");

	// Update sort_order for each ID in the provided order
	for (let i = 0; i < orderedIds.length; i++) {
		await db
			.update(userQuickActions)
			.set({ sort_order: i, updated_at: new Date() })
			.where(and(eq(userQuickActions.id, orderedIds[i]), eq(userQuickActions.user_id, userId)));
	}

	// Return the updated list
	const rows = await db
		.select()
		.from(userQuickActions)
		.where(and(eq(userQuickActions.user_id, userId), eq(userQuickActions.tenant_id, tenantId)))
		.orderBy(asc(userQuickActions.sort_order));

	return rows.map((r) => snakeToCamel(r));
};
