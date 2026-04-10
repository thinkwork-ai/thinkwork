/**
 * Sync all agents linked to a template. Loops syncTemplateToAgent per agent,
 * catching per-agent errors so one failure doesn't abort the batch.
 */

import type { GraphQLContext } from "../../context.js";
import { db, eq, agents } from "../../utils.js";
import { syncTemplateToAgent } from "./syncTemplateToAgent.mutation.js";

export async function syncTemplateToAllAgents(_parent: any, args: any, ctx: GraphQLContext) {
	const { templateId } = args;

	const linked = await db
		.select({ id: agents.id, name: agents.name })
		.from(agents)
		.where(eq(agents.template_id, templateId));

	let agentsSynced = 0;
	let agentsFailed = 0;
	const errors: string[] = [];

	for (const agent of linked) {
		try {
			await syncTemplateToAgent(null, { templateId, agentId: agent.id }, ctx);
			agentsSynced++;
		} catch (err) {
			agentsFailed++;
			errors.push(`${agent.name}: ${(err as Error).message}`);
			console.error(`[syncTemplateToAllAgents] Failed for agent ${agent.id}:`, err);
		}
	}

	return { agentsSynced, agentsFailed, errors };
}
