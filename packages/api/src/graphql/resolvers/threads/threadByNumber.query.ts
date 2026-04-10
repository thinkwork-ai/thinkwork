import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and,
	threads,
	threadToCamel,
} from "../../utils.js";

export const threadByNumber = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db
		.select()
		.from(threads)
		.where(and(eq(threads.tenant_id, args.tenantId), eq(threads.number, args.number)));
	return row ? threadToCamel(row) : null;
};
