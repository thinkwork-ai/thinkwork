import type { GraphQLContext } from "../../context.js";
import { db, eq, and, asc, userQuickActions, snakeToCamel } from "../../utils.js";

export const reorderQuickActions = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const { tenantId, orderedIds, scope: rawScope } = args.input as {
		tenantId: string;
		orderedIds: string[];
		scope?: string | null;
	};
	const scope = rawScope === "task" ? "task" : "thread";
	const userId = ctx.auth.principalId;
	if (!userId) throw new Error("Unauthorized");

	// Update sort_order for each ID in the provided order. Scope is
	// implicit in the ID list — caller sends only the IDs for the
	// scope they're reordering, so we don't need to filter here on
	// write, only on the read-back.
	for (let i = 0; i < orderedIds.length; i++) {
		await db
			.update(userQuickActions)
			.set({ sort_order: i, updated_at: new Date() })
			.where(and(eq(userQuickActions.id, orderedIds[i]), eq(userQuickActions.user_id, userId)));
	}

	// Return the updated list for this scope only so the client can
	// refresh the single list it's showing.
	const rows = await db
		.select()
		.from(userQuickActions)
		.where(
			and(
				eq(userQuickActions.user_id, userId),
				eq(userQuickActions.tenant_id, tenantId),
				eq(userQuickActions.scope, scope),
			),
		)
		.orderBy(asc(userQuickActions.sort_order));

	return rows.map((r) => snakeToCamel(r));
};
