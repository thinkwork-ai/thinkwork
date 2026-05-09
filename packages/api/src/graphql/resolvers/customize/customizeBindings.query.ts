import type { GraphQLContext } from "../../context.js";
import {
  agentSkills,
  and,
  computers,
  connectors,
  db,
  eq,
  isNotNull,
  ne,
} from "../../utils.js";
import { resolveCaller } from "../core/resolve-auth-user.js";

/**
 * Returns the slug / id sets that the apps/computer Customize page uses
 * to mark catalog rows as `connected`.
 *
 *   - **Connectors:** `connectors.catalog_slug` is the canonical pointer
 *     to the catalog row (added by plan 008 U4-1). Rows with a NULL
 *     `catalog_slug` (legacy or pre-backfill) are excluded so they don't
 *     appear bound to anything on the Customize surface.
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

  const agentId = bindingAgentId(
    computer.primary_agent_id,
    computer.migrated_from_agent_id,
  );

  const [connectorRows, skillRows] = await Promise.all([
    db
      .select({
        catalog_slug: connectors.catalog_slug,
        status: connectors.status,
      })
      .from(connectors)
      .where(
        and(
          eq(connectors.tenant_id, tenantId),
          eq(connectors.dispatch_target_type, "computer"),
          eq(connectors.dispatch_target_id, computer.id),
          eq(connectors.enabled, true),
          isNotNull(connectors.catalog_slug),
        ),
      ),
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
  ]);

  const connectedConnectorSlugs = Array.from(
    new Set(
      connectorRows
        .filter(
          (row): row is { catalog_slug: string; status: string } =>
            row.status === "active" && row.catalog_slug !== null,
        )
        .map((row) => row.catalog_slug),
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
