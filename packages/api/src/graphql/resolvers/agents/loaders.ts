import DataLoader from "dataloader";
import { inArray, and, eq } from "drizzle-orm";
import { db, agents as agentsTable, budgetPolicies, agentToCamel, snakeToCamel } from "../../utils.js";

export const createAgentLoaders = () => ({
	agent: new DataLoader<string, any>(async (ids) => {
		const rows = await db.select().from(agentsTable).where(inArray(agentsTable.id, [...ids]));
		const map = new Map(rows.map((r) => [r.id, agentToCamel(r)]));
		return ids.map((id) => map.get(id) || null);
	}),

	budgetPolicyByAgent: new DataLoader<string, any>(async (agentIds) => {
		const rows = await db
			.select()
			.from(budgetPolicies)
			.where(and(inArray(budgetPolicies.agent_id, [...agentIds]), eq(budgetPolicies.scope, "agent")));
		const map = new Map<string, any>();
		for (const r of rows) {
			if (r.agent_id && !map.has(r.agent_id)) {
				map.set(r.agent_id, snakeToCamel(r));
			}
		}
		return agentIds.map((id) => map.get(id) || null);
	}),
});
