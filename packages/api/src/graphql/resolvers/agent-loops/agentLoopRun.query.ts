import { eq } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import { agentLoopRuns, db } from "../../utils.js";
import {
  agentLoopRowToGraphql,
  assertCanReadAgentLoopTenant,
} from "./types.js";

export async function agentLoopRun(
  _parent: unknown,
  args: { id: string },
  ctx: GraphQLContext,
): Promise<unknown | null> {
  const [row] = await db
    .select()
    .from(agentLoopRuns)
    .where(eq(agentLoopRuns.id, args.id))
    .limit(1);

  if (row) {
    await assertCanReadAgentLoopTenant(ctx, row.tenant_id);
  }

  return row ? agentLoopRowToGraphql(row) : null;
}
