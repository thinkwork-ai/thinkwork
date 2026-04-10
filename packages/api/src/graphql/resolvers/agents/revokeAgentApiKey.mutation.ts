import type { GraphQLContext } from "../../context.js";
import { db, eq, agentApiKeys, apiKeyToCamel } from "../../utils.js";

export async function revokeAgentApiKey(_parent: any, args: any, ctx: GraphQLContext) {
	const [row] = await db.update(agentApiKeys)
		.set({ revoked_at: new Date() })
		.where(eq(agentApiKeys.id, args.id))
		.returning();
	if (!row) throw new Error("API key not found");
	return apiKeyToCamel(row);
}
