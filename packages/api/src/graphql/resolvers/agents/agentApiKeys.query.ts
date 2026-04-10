import type { GraphQLContext } from "../../context.js";
import { db, eq, desc, agentApiKeys as agentApiKeysTable, apiKeyToCamel } from "../../utils.js";

export async function agentApiKeys(_parent: any, args: any, ctx: GraphQLContext) {
	const rows = await db.select().from(agentApiKeysTable)
		.where(eq(agentApiKeysTable.agent_id, args.agentId))
		.orderBy(desc(agentApiKeysTable.created_at));
	return rows.map(apiKeyToCamel);
}
