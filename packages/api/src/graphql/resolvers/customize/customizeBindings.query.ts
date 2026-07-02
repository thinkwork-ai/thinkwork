import type { GraphQLContext } from "../../context.js";
import { and, db, eq, routines, isNotNull } from "../../utils.js";
import { resolveCaller } from "../core/resolve-auth-user.js";
import { listEnabledAgentWorkspaceSkillSlugs } from "../../../lib/skills/workspace-skill-index.js";
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

  // KTD-8 (plan U10): connected skills come from the agent workspace —
  // `skills/<slug>/SKILL.md` presence gated by `.assignment.json` enabled
  // state — not the retired agent_skills mirror. An unresolvable
  // workspace degrades to "nothing connected" rather than failing the
  // Customize page.
  const [workspaceSkillSlugs, workflowRows] = await Promise.all([
    listEnabledAgentWorkspaceSkillSlugs(agentId).catch((err) => {
      console.warn("[customizeBindings] workspace skill read failed:", err);
      return null;
    }),
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

  const connectedSkillIds = workspaceSkillSlugs ?? [];
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
    connectedWorkflowTemplateSlugs: connectedWorkflowSlugs,
    connectedWorkflowSlugs,
  };
}
