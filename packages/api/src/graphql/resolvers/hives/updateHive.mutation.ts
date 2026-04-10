import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	hives,
	snakeToCamel,
} from "../../utils.js";

export const updateHive = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	const updates: Record<string, unknown> = { updated_at: new Date() };
	if (i.name !== undefined) updates.name = i.name;
	if (i.description !== undefined) updates.description = i.description;
	if (i.type !== undefined) updates.type = i.type;
	if (i.status !== undefined) updates.status = i.status;
	if (i.budgetMonthlyCents !== undefined) updates.budget_monthly_cents = i.budgetMonthlyCents;
	if (i.metadata !== undefined) updates.metadata = JSON.parse(i.metadata);
	const [row] = await db.update(hives).set(updates).where(eq(hives.id, args.id)).returning();
	if (!row) throw new Error("Hive not found");
	return snakeToCamel(row);
};
