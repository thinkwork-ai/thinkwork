import DataLoader from "dataloader";
import { and, eq, inArray } from "drizzle-orm";
import {
  agentToCamel,
  agents as agentsTable,
  budgetPolicies,
  db,
  snakeToCamel,
} from "../../utils.js";

export const createAgentLoaders = () => ({
  agent: new DataLoader<string, any>(async (ids) => {
    const rows = await db
      .select()
      .from(agentsTable)
      .where(inArray(agentsTable.id, [...ids]));
    const map = new Map(rows.map((row) => [row.id, agentToCamel(row)]));
    return ids.map((id) => map.get(id) || null);
  }),

  budgetPolicyByAgent: new DataLoader<string, any>(async (agentIds) => {
    const rows = await db
      .select()
      .from(budgetPolicies)
      .where(
        and(
          inArray(budgetPolicies.agent_id, [...agentIds]),
          eq(budgetPolicies.scope, "agent"),
        ),
      );
    const map = new Map<string, any>();
    for (const row of rows) {
      if (row.agent_id && !map.has(row.agent_id)) {
        map.set(row.agent_id, snakeToCamel(row));
      }
    }
    return agentIds.map((id) => map.get(id) || null);
  }),
});
