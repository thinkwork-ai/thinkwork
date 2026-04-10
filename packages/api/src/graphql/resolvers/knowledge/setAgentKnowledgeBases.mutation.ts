import type { GraphQLContext } from "../../context.js";
import {
	db, eq, inArray,
	agents, knowledgeBases, agentKnowledgeBases,
	snakeToCamel,
} from "../../utils.js";

export const setAgentKnowledgeBases = async (_parent: any, args: any, ctx: GraphQLContext) => {
	await db.delete(agentKnowledgeBases).where(eq(agentKnowledgeBases.agent_id, args.agentId));
	if (args.knowledgeBases.length === 0) return [];
	const [agent] = await db.select({ tenant_id: agents.tenant_id }).from(agents).where(eq(agents.id, args.agentId));
	if (!agent) throw new Error("Agent not found");

	const rows = await db
		.insert(agentKnowledgeBases)
		.values(
			args.knowledgeBases.map((kb: any) => ({
				agent_id: args.agentId,
				tenant_id: agent.tenant_id,
				knowledge_base_id: kb.knowledgeBaseId,
				enabled: kb.enabled ?? true,
				search_config: kb.searchConfig ? JSON.parse(kb.searchConfig) : undefined,
			})),
		)
		.returning();
	// Resolve joined KB details
	const kbIds = rows.map((r) => r.knowledge_base_id);
	const kbs = kbIds.length > 0
		? await db.select().from(knowledgeBases).where(inArray(knowledgeBases.id, kbIds))
		: [];
	const kbMap = new Map(kbs.map((kb) => [kb.id, snakeToCamel(kb)]));
	// Regenerate AGENTS.md workspace map so KB catalog stays in sync
	try {
		const { regenerateWorkspaceMap } = await import("../../../lib/workspace-map-generator.js");
		regenerateWorkspaceMap(args.agentId).catch((err: unknown) => {
			console.error("[setAgentKnowledgeBases] Failed to regenerate workspace map:", err);
		});
	} catch (err) {
		console.warn("[setAgentKnowledgeBases] workspace-map-generator not available:", err);
	}

	return rows.map((r) => ({
		...snakeToCamel(r),
		knowledgeBase: kbMap.get(r.knowledge_base_id) ?? null,
	}));
};
