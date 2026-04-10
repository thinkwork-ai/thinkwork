import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	budgetPolicies,
} from "../../utils.js";

export const deleteBudgetPolicy = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [deleted] = await db.delete(budgetPolicies)
		.where(eq(budgetPolicies.id, args.id)).returning();
	return !!deleted;
};
