import type { GraphQLContext } from "../../context.js";
import {
	db,
	hives,
	snakeToCamel, generateSlug,
} from "../../utils.js";

export const createHive = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	const [row] = await db
		.insert(hives)
		.values({
			tenant_id: i.tenantId,
			name: i.name,
			slug: generateSlug(),
			description: i.description,
			type: i.type ?? "team",
			budget_monthly_cents: i.budgetMonthlyCents,
			metadata: i.metadata ? JSON.parse(i.metadata) : undefined,
		})
		.returning();
	return snakeToCamel(row);
};
