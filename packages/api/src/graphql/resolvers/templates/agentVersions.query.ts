/**
 * List recent version snapshots for an agent, ordered newest-first.
 * Used by the rollback dropdown on the agent detail page.
 */

import type { GraphQLContext } from "../../context.js";
import { db, eq, desc, agentVersions, snakeToCamel } from "../../utils.js";

export async function agentVersionsList(_parent: any, args: any, _ctx: GraphQLContext) {
	const { agentId, limit } = args;
	const rows = await db
		.select()
		.from(agentVersions)
		.where(eq(agentVersions.agent_id, agentId))
		.orderBy(desc(agentVersions.version_number))
		.limit(limit ?? 20);
	return rows.map((r: any) => snakeToCamel(r));
}
