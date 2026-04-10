import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	randomBytes,
	agents, agentApiKeys,
	apiKeyToCamel, hashToken,
} from "../../utils.js";

export async function createAgentApiKey(_parent: any, args: any, ctx: GraphQLContext) {
	const i = args.input;
	const [agent] = await db.select({ tenant_id: agents.tenant_id }).from(agents).where(eq(agents.id, i.agentId));
	if (!agent) throw new Error("Agent not found");

	const plainKey = `mf_key_${randomBytes(48).toString("hex")}`;
	const keyHash = hashToken(plainKey);

	const [row] = await db.insert(agentApiKeys).values({
		tenant_id: agent.tenant_id,
		agent_id: i.agentId,
		key_hash: keyHash,
		name: i.name,
	}).returning();

	return { apiKey: apiKeyToCamel(row), plainTextKey: plainKey };
}
