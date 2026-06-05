/**
 * tenantSkillCatalog — list the caller-tenant's skill catalog from the derived
 * skill_catalog index (plan 2026-06-04-004 U1). Powers composer/skill pickers
 * such as the slash-command force-pin popup.
 *
 * When `agentId` is provided:
 *  - `installed` is annotated from the agent's agent_skills rows.
 *  - skills in the agent's blocked_tools are omitted entirely (KD4 — the popup
 *    never offers a blocked skill). This is a UX filter; the authoritative
 *    blocklist guardrail is enforced again at dispatch (U2), so bypassing the
 *    picker cannot pin a blocked skill.
 *
 * Reads the index, not S3 — the table exists precisely to avoid scanning the
 * catalog and reading every SKILL.md per load.
 */

import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { db, eq, and, skillCatalog, agents, agentSkills } from "../../utils.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";

interface TenantSkillCatalogArgs {
  agentId?: string | null;
}

export interface SkillCatalogEntryResult {
  slug: string;
  displayName: string | null;
  description: string | null;
  category: string | null;
  icon: string | null;
  tags: string[] | null;
  installed: boolean;
}

export const tenantSkillCatalog = async (
  _parent: unknown,
  args: TenantSkillCatalogArgs,
  ctx: GraphQLContext,
): Promise<SkillCatalogEntryResult[]> => {
  const tenantId = await resolveCallerTenantId(ctx);
  if (!tenantId) {
    throw new GraphQLError("Unable to resolve caller tenant", {
      extensions: { code: "FORBIDDEN" },
    });
  }

  const rows = await db
    .select({
      slug: skillCatalog.slug,
      displayName: skillCatalog.display_name,
      description: skillCatalog.description,
      category: skillCatalog.category,
      icon: skillCatalog.icon,
      tags: skillCatalog.tags,
    })
    .from(skillCatalog)
    .where(eq(skillCatalog.tenant_id, tenantId));

  // Default annotations when no agent context: nothing installed, nothing blocked.
  let installedSlugs = new Set<string>();
  let blockedSlugs = new Set<string>();

  if (args.agentId) {
    const [agent] = await db
      .select({ id: agents.id, blockedTools: agents.blocked_tools })
      .from(agents)
      .where(and(eq(agents.id, args.agentId), eq(agents.tenant_id, tenantId)));
    if (!agent) {
      throw new GraphQLError("Agent not found", {
        extensions: { code: "NOT_FOUND" },
      });
    }
    blockedSlugs = new Set(
      Array.isArray(agent.blockedTools)
        ? (agent.blockedTools as unknown[]).filter(
            (t): t is string => typeof t === "string",
          )
        : [],
    );

    const installed = await db
      .select({ skillId: agentSkills.skill_id })
      .from(agentSkills)
      .where(
        and(
          eq(agentSkills.agent_id, args.agentId),
          eq(agentSkills.tenant_id, tenantId),
        ),
      );
    installedSlugs = new Set(installed.map((r) => r.skillId));
  }

  return rows
    .filter((row) => !blockedSlugs.has(row.slug))
    .map((row) => ({
      slug: row.slug,
      displayName: row.displayName ?? null,
      description: row.description ?? null,
      category: row.category ?? null,
      icon: row.icon ?? null,
      tags: row.tags ?? null,
      installed: installedSlugs.has(row.slug),
    }))
    .sort((a, b) =>
      (a.displayName ?? a.slug).localeCompare(b.displayName ?? b.slug),
    );
};
