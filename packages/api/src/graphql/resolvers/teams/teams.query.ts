import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	teams,
	snakeToCamel,
} from "../../utils.js";

export const teams_ = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const rows = await db.select().from(teams).where(eq(teams.tenant_id, args.tenantId));
	return rows.map(snakeToCamel);
};
