/**
 * runtimeManifestsByTemplate — admin read of the last N Resolved
 * Capability Manifests for agents spawned from a specific template
 * (plan §U15 pt 2/3).
 *
 * Manifests don't currently carry a `template_id` on every row (the
 * runtime emits it only when the session knows it), so this resolver
 * filters on the `template_id` column populated by the manifest-log
 * handler. Cross-tenant probes return an empty list.
 */

import type { GraphQLContext } from "../../context.js";
import {
  db,
  eq,
  and,
  desc,
  agentTemplates,
  resolvedCapabilityManifests,
  snakeToCamel,
} from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export async function runtimeManifestsByTemplate(
  _parent: unknown,
  args: { templateId: string; limit?: number | null },
  ctx: GraphQLContext,
): Promise<Record<string, unknown>[]> {
  const tenantId = await resolveCallerTenantId(ctx);
  if (!tenantId) return [];

  await requireTenantAdmin(ctx, tenantId);

  // Template-tenant ownership check — mirror runtimeManifestsByAgent's
  // pattern so a cross-tenant admin can't enumerate other tenants'
  // template IDs.
  const [template] = await db
    .select({ id: agentTemplates.id, tenant_id: agentTemplates.tenant_id })
    .from(agentTemplates)
    .where(eq(agentTemplates.id, args.templateId))
    .limit(1);
  if (!template || template.tenant_id !== tenantId) return [];

  const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  const rows = await db
    .select()
    .from(resolvedCapabilityManifests)
    .where(
      and(
        eq(resolvedCapabilityManifests.template_id, args.templateId),
        eq(resolvedCapabilityManifests.tenant_id, tenantId),
      ),
    )
    .orderBy(desc(resolvedCapabilityManifests.created_at))
    .limit(limit);

  return rows.map((r) => snakeToCamel(r as Record<string, unknown>));
}
