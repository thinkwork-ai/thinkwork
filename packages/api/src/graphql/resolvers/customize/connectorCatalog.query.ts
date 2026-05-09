import type { GraphQLContext } from "../../context.js";
import { db, eq, tenantConnectorCatalog } from "../../utils.js";
import { resolveCaller } from "../core/resolve-auth-user.js";

export async function connectorCatalog(
  _parent: unknown,
  _args: unknown,
  ctx: GraphQLContext,
) {
  const { tenantId } = await resolveCaller(ctx);
  if (!tenantId) return [];

  const rows = await db
    .select()
    .from(tenantConnectorCatalog)
    .where(eq(tenantConnectorCatalog.tenant_id, tenantId));

  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    slug: r.slug,
    kind: r.kind,
    displayName: r.display_name,
    description: r.description,
    category: r.category,
    icon: r.icon,
    status: r.status,
    enabled: r.enabled,
  }));
}
