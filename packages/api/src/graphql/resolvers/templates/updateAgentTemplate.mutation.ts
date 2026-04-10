import type { GraphQLContext } from "../../context.js";
import { db, eq, agentTemplates, snakeToCamel, sql } from "../../utils.js";

export async function updateAgentTemplate(_parent: any, args: any, _ctx: GraphQLContext) {
	const i = args.input;

	const set: Record<string, any> = { updated_at: sql`now()` };
	if (i.name !== undefined) set.name = i.name;
	if (i.slug !== undefined) set.slug = i.slug;
	if (i.description !== undefined) set.description = i.description;
	if (i.category !== undefined) set.category = i.category;
	if (i.icon !== undefined) set.icon = i.icon;
	if (i.model !== undefined) set.model = i.model;
	if (i.guardrailId !== undefined) set.guardrail_id = i.guardrailId;
	if (i.isPublished !== undefined) set.is_published = i.isPublished;
	if (i.blockedTools !== undefined) {
		set.blocked_tools = typeof i.blockedTools === "string" ? JSON.parse(i.blockedTools) : i.blockedTools;
	}
	if (i.config !== undefined) {
		set.config = typeof i.config === "string" ? JSON.parse(i.config) : i.config;
	}
	if (i.skills !== undefined) {
		set.skills = typeof i.skills === "string" ? JSON.parse(i.skills) : i.skills;
	}
	if (i.knowledgeBaseIds !== undefined) {
		set.knowledge_base_ids = typeof i.knowledgeBaseIds === "string" ? JSON.parse(i.knowledgeBaseIds) : i.knowledgeBaseIds;
	}

	const [row] = await db
		.update(agentTemplates)
		.set(set)
		.where(eq(agentTemplates.id, args.id))
		.returning();

	if (!row) throw new Error("Agent template not found");
	return snakeToCamel(row);
}
