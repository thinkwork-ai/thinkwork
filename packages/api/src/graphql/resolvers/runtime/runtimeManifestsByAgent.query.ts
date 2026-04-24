/**
 * runtimeManifestsByAgent — admin read of the last N Resolved Capability
 * Manifests for a specific agent (plan §U15 pt 2/3).
 *
 * Tenant-scoped via the agent lookup: we load the agent first and
 * require its tenant_id to match the caller's tenant, then list
 * manifests. `requireTenantAdmin` gates the caller. Cross-tenant agent
 * IDs return an empty list rather than 403 — same pattern as
 * skillRuns — so admins don't learn whether a stranger's agent exists.
 */

import type { GraphQLContext } from "../../context.js";
import {
  db,
  eq,
  and,
  desc,
  agents,
  resolvedCapabilityManifests,
  snakeToCamel,
} from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export async function runtimeManifestsByAgent(
  _parent: unknown,
  args: { agentId: string; limit?: number | null },
  ctx: GraphQLContext,
): Promise<Record<string, unknown>[]> {
  const tenantId = await resolveCallerTenantId(ctx);
  if (!tenantId) return [];

  await requireTenantAdmin(ctx, tenantId);

  // Confirm the agent belongs to this tenant — prevents a cross-tenant
  // admin from probing for another tenant's agent ids.
  const [agent] = await db
    .select({ id: agents.id, tenant_id: agents.tenant_id })
    .from(agents)
    .where(eq(agents.id, args.agentId))
    .limit(1);
  if (!agent || agent.tenant_id !== tenantId) return [];

  const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  const rows = await db
    .select()
    .from(resolvedCapabilityManifests)
    .where(
      and(
        eq(resolvedCapabilityManifests.agent_id, args.agentId),
        eq(resolvedCapabilityManifests.tenant_id, tenantId),
      ),
    )
    .orderBy(desc(resolvedCapabilityManifests.created_at))
    .limit(limit);

  return rows.map((r) => snakeToCamel(r as Record<string, unknown>));
}
