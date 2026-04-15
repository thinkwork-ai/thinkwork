import type { GraphQLContext } from "../../context.js";
import { db, eq, and, userQuickActions, snakeToCamel, users, sql } from "../../utils.js";

export const createQuickAction = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	const userId = ctx.auth.principalId;
	if (!userId) throw new Error("Unauthorized");

	const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
	if (!user) throw new Error("User not found");

	// Normalize scope — defaults to "thread" for backwards compat with
	// clients that don't send the field yet.
	const scope = i.scope === "task" ? "task" : "thread";

	// Auto-assign sort_order to end if not specified. Ordering is
	// per-scope so adding a task action doesn't shift the thread list.
	let sortOrder = i.sortOrder;
	if (sortOrder == null) {
		const [max] = await db
			.select({ maxOrder: sql<number>`coalesce(max(${userQuickActions.sort_order}), -1)` })
			.from(userQuickActions)
			.where(
				and(
					eq(userQuickActions.user_id, user.id),
					eq(userQuickActions.tenant_id, i.tenantId),
					eq(userQuickActions.scope, scope),
				),
			);
		sortOrder = (max?.maxOrder ?? -1) + 1;
	}

	const [row] = await db
		.insert(userQuickActions)
		.values({
			user_id: user.id,
			tenant_id: i.tenantId,
			title: i.title,
			prompt: i.prompt,
			workspace_agent_id: i.workspaceAgentId ?? null,
			scope,
			sort_order: sortOrder,
		})
		.returning();

	return snakeToCamel(row);
};
