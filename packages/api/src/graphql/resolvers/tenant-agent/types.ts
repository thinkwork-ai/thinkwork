import { agentToCamel, agents, db, eq } from "../../utils.js";
import type { GraphQLContext } from "../../context.js";

export const agentTypeResolvers = {
  humanPair: (agent: any, _args: unknown, ctx: GraphQLContext) => {
    return agent.humanPairId ? ctx.loaders.user.load(agent.humanPairId) : null;
  },
  budgetPolicy: (agent: any, _args: unknown, ctx: GraphQLContext) => {
    return ctx.loaders.budgetPolicyByAgent.load(agent.id);
  },
  reportsTo: (agent: any, _args: unknown, ctx: GraphQLContext) => {
    return agent.reportsToId ? ctx.loaders.agent.load(agent.reportsToId) : null;
  },
  subAgents: async (agent: any) => {
    const rows = await db
      .select()
      .from(agents)
      .where(eq(agents.parent_agent_id, agent.id));
    return rows.map(agentToCamel);
  },
};
