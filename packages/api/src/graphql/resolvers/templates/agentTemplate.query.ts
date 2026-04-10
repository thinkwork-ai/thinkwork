import type { GraphQLContext } from "../../context.js";
import { db, eq, agentTemplates, snakeToCamel } from "../../utils.js";

export async function agentTemplate(_parent: any, args: any, _ctx: GraphQLContext) {
	const [row] = await db
		.select()
		.from(agentTemplates)
		.where(eq(agentTemplates.id, args.id));
	return row ? snakeToCamel(row) : null;
}
