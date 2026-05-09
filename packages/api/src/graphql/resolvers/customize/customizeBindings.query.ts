import type { GraphQLContext } from "../../context.js";
import {
  agentSkills,
  and,
  computers,
  connectors,
  db,
  eq,
  ne,
} from "../../utils.js";
import { resolveCaller } from "../core/resolve-auth-user.js";

/**
 * Returns the slug / id sets that the apps/computer Customize page uses
 * to mark catalog rows as `connected`. Read-only — mutations come in U4-U6.
 *
 * Matching is best-effort while connector/routine schemas don't carry a
 * dedicated `catalog_slug` column:
 *
 *   - **Connectors:** `connectors.type` is treated as the catalog slug.
 *     Most catalog slugs already match the connector type (slack →
 *     "slack", github → "github"). U4 will add an explicit link column.
 *   - **Skills:** `agent_skills.skill_id` is the same shape as
 *     `tenant_skills.skill_id`. Direct equality.
 *   - **Workflows:** returned empty for v1 — the routines table has no
 *     slug yet. U6 will introduce a catalog-link column and populate
 *     this list.
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

  const [connectorRows, skillRows] = await Promise.all([
    db
      .select({ type: connectors.type, status: connectors.status })
      .from(connectors)
      .where(
        and(
          eq(connectors.tenant_id, tenantId),
          eq(connectors.dispatch_target_type, "computer"),
          eq(connectors.dispatch_target_id, computer.id),
          eq(connectors.enabled, true),
        ),
      ),
    bindingAgentId(computer.primary_agent_id, computer.migrated_from_agent_id)
      ? db
          .select({ skill_id: agentSkills.skill_id })
          .from(agentSkills)
          .where(
            and(
              eq(
                agentSkills.agent_id,
                bindingAgentId(
                  computer.primary_agent_id,
                  computer.migrated_from_agent_id,
                )!,
              ),
              eq(agentSkills.enabled, true),
            ),
          )
      : Promise.resolve([] as { skill_id: string }[]),
  ]);

  const connectedConnectorSlugs = Array.from(
    new Set(
      connectorRows
        .filter((row) => row.status === "active")
        .map((row) => row.type),
    ),
  );
  const connectedSkillIds = Array.from(
    new Set(skillRows.map((row) => row.skill_id)),
  );

  return {
    computerId: computer.id,
    connectedConnectorSlugs,
    connectedSkillIds,
    // Empty in v1; populated by U6 once routines carry a catalog slug link.
    connectedWorkflowSlugs: [] as string[],
  };
}

function bindingAgentId(
  primary: string | null,
  migrated: string | null,
): string | null {
  return primary ?? migrated ?? null;
}
