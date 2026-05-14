import type { GraphQLContext } from "../../context.js";
import {
  agentSkills,
  and,
  computers,
  db,
  eq,
  ne,
  routines,
  isNotNull,
} from "../../utils.js";
import { resolveCaller } from "../core/resolve-auth-user.js";

/**
 * Returns the slug / id sets that the apps/computer Customize page uses
 * to mark catalog rows as `connected`.
 *
 *   - **Skills:** `agent_skills.skill_id` is the same shape as
 *     `tenant_skills.skill_id`. Direct equality.
 *   - **Workflows:** `routines.catalog_slug` is the canonical pointer to
 *     the catalog row (added by plan 010 U6-1). Active rows for the
 *     caller's primary agent appear in the connected list; inactive
 *     rows and pre-backfill rows with a NULL `catalog_slug` are
 *     excluded.
 */
export async function customizeBindings(
  _parent: unknown,
  _args: unknown,
  ctx: GraphQLContext,
) {
  const { tenantId, userId } = await resolveCaller(ctx);
  if (!tenantId || !userId) return null;

  const [computer] = await db
    .select({
      id: computers.id,
      primary_agent_id: computers.primary_agent_id,
      migrated_from_agent_id: computers.migrated_from_agent_id,
    })
    .from(computers)
    .where(
      and(
        eq(computers.tenant_id, tenantId),
        eq(computers.owner_user_id, userId),
        ne(computers.status, "archived"),
      ),
    );
  if (!computer) return null;

  const agentId = bindingAgentId(
    computer.primary_agent_id,
    computer.migrated_from_agent_id,
  );

  const [skillRows, workflowRows] = await Promise.all([
    agentId
      ? db
          .select({ skill_id: agentSkills.skill_id })
          .from(agentSkills)
          .where(
            and(
              eq(agentSkills.agent_id, agentId),
              eq(agentSkills.enabled, true),
            ),
          )
      : Promise.resolve([] as { skill_id: string }[]),
    agentId
      ? db
          .select({ catalog_slug: routines.catalog_slug })
          .from(routines)
          .where(
            and(
              eq(routines.agent_id, agentId),
              eq(routines.status, "active"),
              isNotNull(routines.catalog_slug),
            ),
          )
      : Promise.resolve([] as { catalog_slug: string | null }[]),
  ]);

  const connectedSkillIds = Array.from(
    new Set(skillRows.map((row) => row.skill_id)),
  );
  const connectedWorkflowSlugs = Array.from(
    new Set(
      workflowRows
        .filter((row): row is { catalog_slug: string } => row.catalog_slug !== null)
        .map((row) => row.catalog_slug),
    ),
  );

  return {
    computerId: computer.id,
    connectedSkillIds,
    connectedWorkflowSlugs,
  };
}

function bindingAgentId(
  primary: string | null,
  migrated: string | null,
): string | null {
  return primary ?? migrated ?? null;
}
