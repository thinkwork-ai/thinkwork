import { and, desc, eq, lt } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import { agentLoops as agentLoopsTable, db } from "../../utils.js";
import { ensurePersonalMemoryAutomation } from "../../../lib/memory-sources/provisioning.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import {
  agentLoopRowToGraphql,
  clampAgentLoopQueryLimit,
  normalizeAgentLoopEnum,
  resolveAgentLoopTenantId,
} from "./types.js";

/**
 * THINK-264: the caller's built-in Automations are provisioned on read, so
 * they appear in the inventory for users who have never opened a memory
 * surface. Best-effort: a provisioning hiccup must not blank the whole
 * Automations page — the user's own Automations still list.
 */
async function ensureSystemAutomations(
  ctx: GraphQLContext,
  tenantId: string,
): Promise<void> {
  try {
    const userId = await resolveCallerUserId(ctx);
    if (!userId) return; // service callers have no personal automation
    await ensurePersonalMemoryAutomation(db, { tenantId, userId });
  } catch (error) {
    console.warn("[agentLoops] system automation ensure failed", error);
  }
}

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
  await ensureSystemAutomations(ctx, tenantId);
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
