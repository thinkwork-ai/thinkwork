import type { GraphQLContext } from "../../context.js";
import {
  and,
  agentWorkspaceRuns,
  db,
  desc,
  eq,
  snakeToCamel,
} from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export async function agentWorkspaceRuns_(
  _parent: unknown,
  args: {
    agentId?: string | null;
    targetPath?: string | null;
    status?: string | null;
    limit?: number | null;
  },
  ctx: GraphQLContext,
): Promise<Record<string, unknown>[]> {
  const tenantId = await resolveCallerTenantId(ctx);
  if (!tenantId) return [];
  await requireTenantAdmin(ctx, tenantId);

  const conditions = [eq(agentWorkspaceRuns.tenant_id, tenantId)];
  if (args.agentId)
    conditions.push(eq(agentWorkspaceRuns.agent_id, args.agentId));
  if (args.targetPath != null) {
    conditions.push(eq(agentWorkspaceRuns.target_path, args.targetPath));
  }
  if (args.status) {
    conditions.push(eq(agentWorkspaceRuns.status, args.status.toLowerCase()));
  }

  const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const rows = await db
    .select()
    .from(agentWorkspaceRuns)
    .where(and(...conditions))
    .orderBy(desc(agentWorkspaceRuns.last_event_at))
    .limit(limit);

  return rows.map((row) => snakeToCamel(row as Record<string, unknown>));
}
