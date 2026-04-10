import type { GraphQLContext } from "../../context.js";
import {
	db,
	recipes,
	recipeToCamel,
} from "../../utils.js";

export const createRecipe = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	const [row] = await db
		.insert(recipes)
		.values({
			tenant_id: i.tenantId,
			agent_id: i.agentId ?? null,
			thread_id: i.threadId ?? null,
			title: i.title,
			summary: i.summary ?? null,
			server: i.server,
			tool: i.tool,
			params: typeof i.params === "string" ? JSON.parse(i.params) : i.params,
			genui_type: i.genuiType,
			templates: i.templates
				? typeof i.templates === "string" ? JSON.parse(i.templates) : i.templates
				: null,
			source_message_id: i.sourceMessageId ?? null,
		})
		.returning();
	return recipeToCamel(row);
};
