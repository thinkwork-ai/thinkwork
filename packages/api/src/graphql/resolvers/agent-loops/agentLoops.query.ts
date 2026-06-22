import { and, desc, eq, lt } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import { agentLoops as agentLoopsTable, db } from "../../utils.js";
import {
  agentLoopRowToGraphql,
  clampAgentLoopQueryLimit,
  normalizeAgentLoopEnum,
  resolveAgentLoopTenantId,
} from "./types.js";

export async function agentLoops(
  _parent: unknown,
  args: {
    tenantId: string;
    lifecycleStatus?: string | null;
    enabled?: boolean | null;
    limit?: number | null;
    cursor?: string | null;
  },
  ctx: GraphQLContext,
): Promise<unknown[]> {
  const tenantId = await resolveAgentLoopTenantId(ctx, args.tenantId);
  const conditions = [eq(agentLoopsTable.tenant_id, tenantId)];

  const lifecycleStatus = normalizeAgentLoopEnum(args.lifecycleStatus);
  if (lifecycleStatus) {
    conditions.push(eq(agentLoopsTable.lifecycle_status, lifecycleStatus));
  }
  if (args.enabled !== undefined && args.enabled !== null) {
    conditions.push(eq(agentLoopsTable.enabled, args.enabled));
  }
  if (args.cursor) {
    conditions.push(lt(agentLoopsTable.updated_at, new Date(args.cursor)));
  }

  const rows = await db
    .select()
    .from(agentLoopsTable)
    .where(and(...conditions))
    .orderBy(desc(agentLoopsTable.updated_at))
    .limit(clampAgentLoopQueryLimit(args.limit));

  return rows.map(agentLoopRowToGraphql);
}
