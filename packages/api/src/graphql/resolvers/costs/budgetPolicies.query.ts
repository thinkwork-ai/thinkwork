import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	budgetPolicies,
	snakeToCamel,
} from "../../utils.js";

export const budgetPolicies_ = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const rows = await db.select().from(budgetPolicies)
		.where(eq(budgetPolicies.tenant_id, args.tenantId));
	return rows.map(snakeToCamel);
};
