import type { GraphQLContext } from "../../context.js";
import { db, eq, agentTemplates, templateToCamel } from "../../utils.js";
import { withGraphqlAgentRuntime } from "../agents/runtime.js";

export async function agentTemplates_query(
  _parent: any,
  args: any,
  _ctx: GraphQLContext,
) {
  const rows = await db
    .select()
    .from(agentTemplates)
    .where(eq(agentTemplates.tenant_id, args.tenantId));
  return rows.map((row) => withGraphqlAgentRuntime(templateToCamel(row)));
}
