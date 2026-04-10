import type { GraphQLContext } from "../../context.js";
import {
	db, eq, desc,
	knowledgeBases,
	snakeToCamel,
} from "../../utils.js";

export const knowledgeBases_ = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const rows = await db.select().from(knowledgeBases)
		.where(eq(knowledgeBases.tenant_id, args.tenantId))
		.orderBy(desc(knowledgeBases.created_at));
	return rows.map(snakeToCamel);
};
