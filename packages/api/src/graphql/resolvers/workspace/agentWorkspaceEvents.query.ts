import type { GraphQLContext } from "../../context.js";
import {
  agentWorkspaceEvents,
  agentWorkspaceRuns,
  and,
  db,
  desc,
  eq,
  snakeToCamel,
} from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

export async function agentWorkspaceEvents_(
  _parent: unknown,
  args: { runId: string; limit?: number | null },
  ctx: GraphQLContext,
): Promise<Record<string, unknown>[]> {
  const [run] = await db
    .select({
      id: agentWorkspaceRuns.id,
      tenant_id: agentWorkspaceRuns.tenant_id,
    })
    .from(agentWorkspaceRuns)
    .where(eq(agentWorkspaceRuns.id, args.runId))
    .limit(1);
  if (!run) return [];
  await requireTenantAdmin(ctx, run.tenant_id);

  const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const rows = await db
    .select()
    .from(agentWorkspaceEvents)
    .where(
      and(
        eq(agentWorkspaceEvents.tenant_id, run.tenant_id),
        eq(agentWorkspaceEvents.run_id, run.id),
      ),
    )
    .orderBy(desc(agentWorkspaceEvents.created_at))
    .limit(limit);

  return rows.map((row) => snakeToCamel(row as Record<string, unknown>));
}
