import { eq } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import { agentLoopRuns, agentLoops, db } from "../../utils.js";
import {
  agentLoopRowToGraphql,
  canReadAgentLoop,
  type AgentLoopAccessScope,
} from "./types.js";

export async function agentLoopRun(
  _parent: unknown,
  args: { id: string; scope?: AgentLoopAccessScope | null },
  ctx: GraphQLContext,
): Promise<unknown | null> {
  const [row] = await db
    .select()
    .from(agentLoopRuns)
    .where(eq(agentLoopRuns.id, args.id))
    .limit(1);

  if (row) {
    const [loop] = await db
      .select({
        tenant_id: agentLoops.tenant_id,
        owner_user_id: agentLoops.owner_user_id,
      })
      .from(agentLoops)
      .where(eq(agentLoops.id, row.agent_loop_id))
      .limit(1);
    if (!loop || !(await canReadAgentLoop(ctx, loop, args.scope ?? "USER"))) {
      return null;
    }
  }

  return row ? agentLoopRowToGraphql(row) : null;
}
