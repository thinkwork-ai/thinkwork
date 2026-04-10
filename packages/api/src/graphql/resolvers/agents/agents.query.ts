import { isNull } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import {
	db, eq, ne, and,
	agents as agentsTable, agentToCamel,
} from "../../utils.js";

export async function agents(_parent: any, args: any, ctx: GraphQLContext) {
	const conditions = [eq(agentsTable.tenant_id, args.tenantId), ne(agentsTable.status, "archived")];
	if (!args.includeSystem) conditions.push(ne(agentsTable.source, "system"));
	if (args.status) conditions.push(eq(agentsTable.status, args.status.toLowerCase()));
	if (args.type) conditions.push(eq(agentsTable.type, args.type.toLowerCase()));
	if (args.humanPairId) conditions.push(eq(agentsTable.human_pair_id, args.humanPairId));
	// Exclude sub-agents from the main list (they appear on their parent's detail page)
	if (!args.includeSubAgents) conditions.push(isNull(agentsTable.parent_agent_id));
	const rows = await db.select().from(agentsTable).where(and(...conditions));
	return rows.map((r) => agentToCamel(r));
}
