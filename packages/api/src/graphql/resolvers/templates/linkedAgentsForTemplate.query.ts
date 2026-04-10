/**
 * Return all agents linked to a given agent template.
 */

import type { GraphQLContext } from "../../context.js";
import { db, eq, agents, agentToCamel } from "../../utils.js";

export async function linkedAgentsForTemplate(_parent: any, args: any, _ctx: GraphQLContext) {
	const { templateId } = args;
	const rows = await db.select().from(agents).where(eq(agents.template_id, templateId));
	return rows.map((r: any) => agentToCamel(r));
}
