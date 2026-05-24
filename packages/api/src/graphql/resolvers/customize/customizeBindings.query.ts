import type { GraphQLContext } from "../../context.js";
import { agentSkills, and, db, eq, routines, isNotNull } from "../../utils.js";
import { resolveCaller } from "../core/resolve-auth-user.js";
import {
  PlatformAgentNotFoundError,
  resolveTenantPlatformAgent,
} from "../../../lib/agents/tenant-platform-agent.js";

/**
 * Returns the slug / id sets the Customize page uses to mark catalog
 * rows as `connected` for the caller's tenant platform agent.
 */
export async function customizeBindings(
  _parent: unknown,
  _args: unknown,
  ctx: GraphQLContext,
) {
  const { tenantId, userId } = await resolveCaller(ctx);
  if (!tenantId || !userId) return null;

  let agentId: string;
  try {
    const agent = await resolveTenantPlatformAgent(tenantId);
    agentId = agent.id;
  } catch (err) {
    if (err instanceof PlatformAgentNotFoundError) return null;
    throw err;
  }

  const [skillRows, workflowRows] = await Promise.all([
    db
      .select({ skill_id: agentSkills.skill_id })
      .from(agentSkills)
      .where(
        and(eq(agentSkills.agent_id, agentId), eq(agentSkills.enabled, true)),
      ),
    db
      .select({ catalog_slug: routines.catalog_slug })
      .from(routines)
      .where(
        and(
          eq(routines.agent_id, agentId),
          eq(routines.status, "active"),
          isNotNull(routines.catalog_slug),
        ),
      ),
  ]);

  const connectedSkillIds = Array.from(
    new Set(skillRows.map((row) => row.skill_id)),
  );
  const connectedWorkflowSlugs = Array.from(
    new Set(
      workflowRows
        .filter(
          (row): row is { catalog_slug: string } => row.catalog_slug !== null,
        )
        .map((row) => row.catalog_slug),
    ),
  );

  return {
    agentId,
    connectedSkillIds,
    connectedWorkflowSlugs,
  };
}
