import type { GraphQLContext } from "../../context.js";
import { db, eq, agentTemplates, templateToCamel } from "../../utils.js";
import { withGraphqlAgentRuntime } from "../agents/runtime.js";

export async function agentTemplate(
  _parent: any,
  args: any,
  _ctx: GraphQLContext,
) {
  const [row] = await db
    .select()
    .from(agentTemplates)
    .where(eq(agentTemplates.id, args.id));
  return row ? withGraphqlAgentRuntime(templateToCamel(row)) : null;
}
