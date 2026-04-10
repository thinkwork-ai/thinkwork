import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	tenantSettings,
	snakeToCamel,
} from "../../utils.js";

export const updateTenantSettings = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	const updates: Record<string, unknown> = { updated_at: new Date() };
	if (i.defaultModel !== undefined) updates.default_model = i.defaultModel;
	if (i.budgetMonthlyCents !== undefined) updates.budget_monthly_cents = i.budgetMonthlyCents;
	if (i.autoCloseThreadMinutes !== undefined) updates.auto_close_thread_minutes = i.autoCloseThreadMinutes;
	if (i.maxAgents !== undefined) updates.max_agents = i.maxAgents;
	if (i.features !== undefined) updates.features = JSON.parse(i.features);
	const [row] = await db
		.update(tenantSettings)
		.set(updates)
		.where(eq(tenantSettings.tenant_id, args.tenantId))
		.returning();
	if (!row) throw new Error("Tenant settings not found");
	return snakeToCamel(row);
};
