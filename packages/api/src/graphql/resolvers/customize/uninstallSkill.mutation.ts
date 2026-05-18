/**
 * uninstallSkill — delete a tenant_skills row.
 *
 * Idempotent — returns false (no-op) when no row matches. Does NOT
 * cascade to agent_skills assignments; agents that still reference
 * this skill in their AGENTS.md routing will continue to do so until
 * the operator updates the agent. The derive-agent-skills pipeline
 * eventually flags this as a missing-skill condition during the next
 * AGENTS.md put.
 *
 * Auth: `requireAdminOrServiceCaller`. Tenant-tier mutation; service
 * callers admitted.
 */

import type { GraphQLContext } from "../../context.js";
import { db, eq, and, tenantSkills } from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";

export const uninstallSkill = async (
  _parent: unknown,
  args: { tenantId: string; skillId: string },
  ctx: GraphQLContext,
): Promise<boolean> => {
  await requireAdminOrServiceCaller(ctx, args.tenantId, "uninstall_skill");

  const deleted = await db
    .delete(tenantSkills)
    .where(
      and(
        eq(tenantSkills.tenant_id, args.tenantId),
        eq(tenantSkills.skill_id, args.skillId),
      ),
    )
    .returning({ id: tenantSkills.id });

  return deleted.length > 0;
};
