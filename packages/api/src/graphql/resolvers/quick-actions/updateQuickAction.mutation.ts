import type { GraphQLContext } from "../../context.js";
import { db, eq, userQuickActions, snakeToCamel } from "../../utils.js";

export const updateQuickAction = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const { id, input: i } = args;
	const userId = ctx.auth.principalId;
	if (!userId) throw new Error("Unauthorized");

	// Verify ownership
	const [existing] = await db.select().from(userQuickActions).where(eq(userQuickActions.id, id));
	if (!existing || existing.user_id !== userId) throw new Error("Quick action not found");

	const updates: Record<string, any> = { updated_at: new Date() };
	if (i.title !== undefined) updates.title = i.title;
	if (i.prompt !== undefined) updates.prompt = i.prompt;
	if (i.workspaceAgentId !== undefined) updates.workspace_agent_id = i.workspaceAgentId;
	if (i.sortOrder !== undefined) updates.sort_order = i.sortOrder;
	// Allow moving an action between scopes. Rare in practice but
	// harmless to support and useful for a "convert to task action"
	// affordance we might add later.
	if (i.scope !== undefined) {
		updates.scope = i.scope === "task" ? "task" : "thread";
	}

	const [row] = await db
		.update(userQuickActions)
		.set(updates)
		.where(eq(userQuickActions.id, id))
		.returning();

	return snakeToCamel(row);
};
