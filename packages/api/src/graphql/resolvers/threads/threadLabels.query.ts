import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	threadLabels,
	snakeToCamel,
} from "../../utils.js";

export const threadLabels_query = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const rows = await db.select().from(threadLabels).where(eq(threadLabels.tenant_id, args.tenantId));
	return rows.map(snakeToCamel);
};
