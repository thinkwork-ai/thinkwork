import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	teams,
	snakeToCamel,
} from "../../utils.js";

export const updateTeam = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	const updates: Record<string, unknown> = { updated_at: new Date() };
	if (i.name !== undefined) updates.name = i.name;
	if (i.description !== undefined) updates.description = i.description;
	if (i.type !== undefined) updates.type = i.type;
	if (i.status !== undefined) updates.status = i.status;
	if (i.budgetMonthlyCents !== undefined) updates.budget_monthly_cents = i.budgetMonthlyCents;
	if (i.metadata !== undefined) updates.metadata = JSON.parse(i.metadata);
	const [row] = await db.update(teams).set(updates).where(eq(teams.id, args.id)).returning();
	if (!row) throw new Error("Team not found");
	return snakeToCamel(row);
};
