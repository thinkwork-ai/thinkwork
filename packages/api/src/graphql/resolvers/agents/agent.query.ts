import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and, inArray,
	agents, agentCapabilities, agentSkills,
	budgetPolicies, knowledgeBases, agentKnowledgeBases, users,
	snakeToCamel, agentToCamel,
} from "../../utils.js";

export async function agent(_parent: any, args: any, ctx: GraphQLContext) {
	const [row] = await db.select().from(agents).where(eq(agents.id, args.id));
	if (!row) return null;
	const result = agentToCamel(row);
	const [caps, skls, pols, akbs] = await Promise.all([
		db.select().from(agentCapabilities).where(eq(agentCapabilities.agent_id, args.id)),
		db.select().from(agentSkills).where(eq(agentSkills.agent_id, args.id)),
		db.select().from(budgetPolicies).where(and(eq(budgetPolicies.agent_id, args.id), eq(budgetPolicies.scope, "agent"))),
		db.select().from(agentKnowledgeBases).where(eq(agentKnowledgeBases.agent_id, args.id)),
	]);
	result.capabilities = caps.map(snakeToCamel);
	result.skills = skls.map(snakeToCamel);
	result.budgetPolicy = pols.length > 0 ? snakeToCamel(pols[0]) : null;
	// Resolve knowledge bases with joined KB details
	if (akbs.length > 0) {
		const kbIds = akbs.map((a) => a.knowledge_base_id);
		const kbs = await db.select().from(knowledgeBases).where(inArray(knowledgeBases.id, kbIds));
		const kbMap = new Map(kbs.map((kb) => [kb.id, snakeToCamel(kb)]));
		result.knowledgeBases = akbs.map((a) => ({
			...snakeToCamel(a),
			knowledgeBase: kbMap.get(a.knowledge_base_id) ?? null,
		}));
	} else {
		result.knowledgeBases = [];
	}
	if (row.human_pair_id) {
		const [humanUser] = await db.select().from(users).where(eq(users.id, row.human_pair_id));
		result.humanPair = humanUser ? snakeToCamel(humanUser) : null;
	}
	return result;
}
