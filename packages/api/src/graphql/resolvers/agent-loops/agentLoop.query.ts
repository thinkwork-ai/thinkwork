import { eq } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import { agentLoops, db } from "../../utils.js";
import {
  agentLoopRowToGraphql,
  canReadAgentLoop,
  type AgentLoopAccessScope,
} from "./types.js";

export async function agentLoop(
  _parent: unknown,
  args: { id: string; scope?: AgentLoopAccessScope | null },
  ctx: GraphQLContext,
): Promise<unknown | null> {
  const [row] = await db
    .select()
    .from(agentLoops)
    .where(eq(agentLoops.id, args.id))
    .limit(1);

  if (row && !(await canReadAgentLoop(ctx, row, args.scope ?? "USER"))) {
    return null;
  }

  return row ? agentLoopRowToGraphql(row) : null;
}
