import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	hivePolicies,
} from "../../utils.js";

export const deleteHivePolicy = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db.delete(hivePolicies).where(eq(hivePolicies.id, args.id)).returning();
	return !!row;
};
