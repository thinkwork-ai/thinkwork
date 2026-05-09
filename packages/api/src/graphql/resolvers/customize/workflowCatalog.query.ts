import type { GraphQLContext } from "../../context.js";
import { db, eq, tenantWorkflowCatalog } from "../../utils.js";
import { resolveCaller } from "../core/resolve-auth-user.js";

export async function workflowCatalog(
  _parent: unknown,
  _args: unknown,
  ctx: GraphQLContext,
) {
  const { tenantId } = await resolveCaller(ctx);
  if (!tenantId) return [];

  const rows = await db
    .select()
    .from(tenantWorkflowCatalog)
    .where(eq(tenantWorkflowCatalog.tenant_id, tenantId));

  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    slug: r.slug,
    displayName: r.display_name,
    description: r.description,
    category: r.category,
    icon: r.icon,
    defaultSchedule: r.default_schedule,
    status: r.status,
    enabled: r.enabled,
  }));
}
